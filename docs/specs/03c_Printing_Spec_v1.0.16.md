# 03c Printing — Module Spec

| | |
|---|---|
| Doc | Module spec, **v1.0.16 — DRAFT (pending hostile review + owner), 2026-11-24 (02b-TK owner ruling R6, `docs/plans/02b-tk-rulings.md`; gap G-11 of `docs/design/handoff/02b-tk/GAPS.md`)**: a **takeaway token slip** (English / Roman Urdu, token large, "Ready around", QR to the customer status page, "Pay at the counter") printed only for **pay-later** takeaway orders, queued **in the `SubmitOrder` transaction** when the client sets 02b v1.0.25's `takeaway.print_slip` on *Send · pay later* (§3.11), and by a staff command `PrintTakeawaySlip` (§6.14) for a Send & pay panel closed unpaid and for a reprint from the token view; the slip is a `document` job (no job kind, no migration); **no Urdu script on any print** (R6, PC437 only). ⚠️ Changed by v1.0.16 (02b-TK R6); fixes of hostile run 1 (`docs/reviews/03c_v1.0.16_hostile_run1.md`, 2 BLOCKER, 6 MAJOR, 13 MINOR) marked "⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)", list under the changelog. v1.0.15 kept. **v1.0.15 — APPROVED (owner 2026-11-22, STAB-5 proposal `docs/plans/stab-b2-unit-split-proposal.md` §3.5; STAB-5 phase 3)**: kitchen ticket rows group a split line's parts (`part_of`, 02b v1.0.20 §3.2 step 4a) into one row "3 x Naan". **v1.0.14 — APPROVED (status carried as v1.0.13's, + R-38 owner ruling 2026-11-20 on the P0.16 Printers page)** ⚠️ Changed by 05 (row P-1, R-38): `print-config` also returns `zones` and `floors` (read from the branch config in memory, 0 extra statements, still 5), and §6.13 records two readings of `SetBillRoute` (`ref_id` shape, archived zone / revoked device still exist); no other rule changes; v1.0.13 kept. **v1.0.13 — APPROVED (status carried as v1.0.12's, + R-26 owner ruling 2026-11-19 on the P0.17 QR review and R-35 owner ruling 2026-11-20)** ⚠️ Changed by 05 (row P-2, R-35): `documentJobsStatus` also returns `printer_name` (joined from `printers`, still 1 statement). ⚠️ Changed by 05 (row P-3, R-26): the QR block's default module size by the printer's paper width (6 on 80 mm, 4 on 58 mm), a block's own `size` wins, the 400 limit in code points, `pL pH` = UTF-8 bytes + 3; no other rule changes; v1.0.12 kept. **v1.0.12 — APPROVED (Owner, 2026-11-17, 04 Z3a)** (status carried as v1.0.11's, + R-22 owner ruling 2026-11-19 on the P0.16 bill-route gaps) ⚠️ Changed by 05 (row P-1, R-22): bill-route scopes, `ref_id`, one route per key, permission, reference checks, archive-in-use details; no other rule changes; v1.0.11 kept. **v1.0.11 — APPROVED (Owner, 2026-11-17, 04 Z3a)** (carried from v1.0.10; the 05 rows P-1–P-5 are 05 v1.0 §4.5 text, owner-approved with 05 v1.0 on 2026-11-18 16:33 PKT; numbers as re-taken in 05 v1.0.1; applied by 05 phase 0 task P0.2i, 2026-11-19) ⚠️ Changed by 05 (rows P-1–P-5): bill routes, document-job retarget and status, QR block, document filler, `renderText` in `@pos/domain`; no other rule changes; v1.0.10 kept. **v1.0.10 — APPROVED (Owner, 2026-11-17, 04 Z3a)** (reconcile of main v1.0.9 and module-04 v1.0.8; no rule changes). **v1.0.8 — APPROVED (owner ruling 2026-11-12 20:21 PKT, "haan": 04 ruling Q-15 (b); code in 04 task p1)** (MOVED TO STOCK slip for a `moved` void share; its text `MOVED TO STOCK - FINISH & KEEP` per 04 Q-17, owner 20:42 PKT; multi-language slips a future feature, §12.7). **v1.0.9 — APPROVED (owner rulings 2026-11-13 06:02 PKT, "Sab rec": 03b / 03c client gap sweep Q-48, Q-50, Q-54, Q-57, all Rec (a))**; made on `main`'s v1.0.7 — **v1.0.8 is module-04's** (04 Q-15 / Q-17, MOVED TO STOCK slip, on `origin/module-04`), folded in v1.0.10 (`docs/OPEN-QUESTIONS.md` §10 03-F1). v1.0.7 — APPROVED (owner ruling 2026-11-12, "sab rec" on the PR #84 review: Q-P22b). v1.0.6 — APPROVED (owner rulings 2026-11-12 11:00, "teeno Rec": Q-14, Q-18, Q-20 of the design brief). v1.0.5 — APPROVED (owner rulings 2026-11-12, "sab Rec": C3-2, C3-3, C4-1). v1.0.4 — APPROVED (owner ruling 2026-11-11: C1-2 (a)). v1.0.3 — APPROVED (owner rulings 2026-11-11: B3-2, C1-1, both (a))**. v1.0.2 — APPROVED (owner, 2026-11-11; wording only: 02b's bump is v1.0.6, AD-15; no behaviour change). v1.0.1 — APPROVED (owner, 2026-11-11, 16:23 PKT; gap-sweep rulings G-7, G-8, G-14, `docs/plans/03b-03c-gaps.md`). v1.0 — APPROVED (owner, 2026-11-11, 13:40 PKT; approved together with 03b v1.0). Content = v0.2.1 (+ OQ-C1 answer), unchanged, plus v1.0.1's marked wording fix. v0.2.1 was v0.2 + the re-check's wording fixes (`docs/reviews/03b_v0.4_03c_v0.2_recheck.md`; §12.6). Split out of 03b by the owner's ruling R-2: screens are 03b's, **the printer is an optional accessory** (R-1). v0.1 carried 03b v0.2's printing rules with run 2's printing findings fixed (§12.4); v0.2 closes the targeted check `docs/reviews/03b_v0.3_03c_v0.1_targeted_check.md` (§12.5). Re-check done (M-3 partly → fixed in v0.2.1). |
| Depends on | ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): **00 Hub Platform Access v1.13** (DRAFT; §4.2 export `statusLink(order_id) → { path, url }` (⚠️ Changed by v1.0.16 (integration, 02b-TK): `→ { path, url } \| null`, 00 HPA v1.13 M-3: `null` while `public_status.enabled` is off, without `advertised_host`, for a non-ULID id or with no key), M98: `url` = `http://<advertised_host>:<public_port>/t/<order_id>.<mac>` (⚠️ Changed by v1.0.16 (integration, 02b-TK): the **public** listener's port `public_status.port`, default `http_port + 1`, 00 HPA v1.13 M-4; was `<http_port>`), ≈ 70 ASCII characters, pure, 0 statements), **02b v1.0.25** (DRAFT; `orders.pickup_at_ms`, and the `SubmitOrder` rows Q-TK-1…Q-TK-3 of §4.4), **03a v1.2.11** (DRAFT; R4 pickup landing, §3.5.8 PK-1…PK-12: a pickup order's groups target `T_L = max(pickup, land)`), **01a v2.11** (DRAFT; ~~the setting `takeaway_slip_on_send` is **not yet in it**: rows TS-1…TS-4 of §4.4 ask for it~~ ⚠️ Changed by v1.0.16 (integration, 02b-TK): the setting is in 01a v2.11 rows TS-1 – TS-4, and on the 01b v1.12 settings wire, row B-1), **05 Billing v1.0.35** (DRAFT; §3.16 reads the customer line time from 03c's `customerReadyAt`). These are approved together with this version; none is a forward reference outside an *Exposes* row or a §4.4 row. Read only: 02b `orders` (`token`, `business_date`, `placed_at`, `billed_at`, `cancelled_at`, `pickup_at_ms`), 03a engine state. Earlier: **03b KDS + Pass v1.0.8** (⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-50): was v1.0.7 — the slot contract of 03b v1.0.8 §8; ⚠️ Changed by v1.0.7 (owner 2026-11-12, Q-P22b): was v1.0.6; ⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-20): was v1.0.5; ⚠️ Changed by v1.0.5 (owner 2026-11-12): was v1.0.3), **02b v1.0.7**, **03a v1.2.2** (⚠️ Changed by v1.0.3 (owner 2026-11-11, B3-2): was 03b v1.0.2; ⚠️ Changed by v1.0.2 (AD-15): was v1.0.1; ⚠️ Changed by v1.0.1 (G-14): was v1.0) (`stationPresence`, `buildLineDetails`, `pointOfLine`, `devicePoint`, client slots), Foundation **v1.11**, 00 **v1.8**, 01a **v2.3**, 01b **v1.7** (+ 03b's B-1), 01d **v1.2.1** (+ 03b's D-2), 02a **v1.1.4** (02b and 03a: the v1.0.7 / v1.2.2 named above; ⚠️ Changed by v1.0.3 (owner 2026-11-11, B3-2): was 02b **v1.0.3** (+ `module-02b` after merge), 03a **v1.2**). Target versions: one bump per target, applied by 03b's task 0d, with 03b v0.4.1 §4.5's fallback if 03c is approved separately. ⚠️ Changed by v1.0.8 (04 Q-15): the MOVED TO STOCK slip reads `ItemVoided.disposition`, an optional field of **03a v1.2.4** (04 row T-1, built on `module-04`). |
| Read by | 05 (print API), 07. |
| Inherits | Shared Standards from Foundation v1.11 §6. |
| Inputs | `03b-g0.md` (§6 Q1, Q2, Q3, Q4, Q9, Q10, Q13), `03b-g1-decisions.md` (G1-1–G1-5, G1-14, G1-15, R-1, R-2, R-5, R-6), OQ-1 answer; run 1 and run 2 reviews; 02b v1.0.2 §4.3 To 03b, O16; Foundation §5.8, D24, R8. |
| Rigor | T2 (CLAUDE.md). |

### Changelog

| Version | Date | Change |
|---|---|---|
| **v1.0.16** | 2026-11-24 | **DRAFT (pending hostile review + owner).** 02b-TK owner ruling **R6** (24 Nov 2026, `docs/plans/02b-tk-rulings.md`: "No Urdu on any print (PC437). On payment the receipt prints by default (as today). A 'Print check bill' action is on the cart and the token view (`PrintCheckBill`). A token slip (English / Roman Urdu, with QR) prints only for pay-later takeaway orders."); gap **G-11** (`docs/design/handoff/02b-tk/GAPS.md`, frame `TokenSlip.dc.html`; where the hand-off differs (an Urdu line, the slip merged into the receipt) the ruling wins). Marked "⚠️ Changed by v1.0.16 (02b-TK R6)"; the hostile run 1 fixes are marked "⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)" and listed in the table below. **(1)** §1.2, §1.3, §1.4 P10, P15: no Urdu script on any print; a takeaway token slip for pay-later orders only. **(2)** §3.11: layout (branch name, `TOKEN` and the number at text size 2, "Aap ka token: 57", "Ready around 1:42 PM", "PAY AT THE COUNTER" + "Paise counter par dein", QR of 00 HPA v1.13 `statusLink(root).url` (⚠️ Changed by v1.0.16 (integration, 02b-TK): `statusLink(root)?.url`, no QR when `null`), two scan lines, footer; REPRINT line on a reprint; no items, prices or names); builder `buildTakeawaySlipDoc`; the ready time from the new pure export `customerReadyAt` (05 §3.16's line time, moved here) with the pickup rule of R4; a **`document` job** through `printDocument` (gains an optional `order_id` meta, stored in the existing column): no job kind, **no migration**. **(3)** Trigger: on **`SubmitOrder`** with 02b v1.0.25's `takeaway.print_slip: true` (client: *Send · pay later*), queued in the same transaction by 03c's `queueTakeawaySlipOnSubmit` (a command-time hook, not a fold; a queued replay prints only within `TAKEAWAY_SLIP_REPLAY_MS` of its `queued_at`); and the staff command **`PrintTakeawaySlip { order_id, reason: 'pay_later' \| 'reprint', printer_id? }`** (§6.14; any `take-order` holder; ≤ 5 statements) for a Send & pay panel closed unpaid and for a reprint. Never for a billed order. Duplicates: `pay_later` skips when the token already has a slip; a reprint says REPRINT. Setting `takeaway_slip_on_send` (01a rows TS-1…TS-4, default on). Routing: payload printer, else device → default. **(4)** §3.9, §3.10, §4.1–§4.4 (rows TS-1…TS-4, B-TK-1, Q-TK-1…Q-TK-4), §5 note, §6.7 (`kind_label`), §8, §9 new code **`TAKEAWAY_SLIP_NOT_ALLOWED`** (409; reasons `not_takeaway`, `cancelled`, `billed`), §10 tests 57–66, §11 tasks 29–33, §12.2 rows 14–15, §12.3 owner decisions D-1…D-8. No event, no table, no job kind, no migration. v1.0.15 kept. |
| **v1.0.15** | 2026-11-22 | **APPROVED (owner 2026-11-22, "yes start stab 5"; proposal `docs/plans/stab-b2-unit-split-proposal.md` §3.5 "Tickets / printing (03c): one ticket row per group with its count"; plan `docs/plans/stab-5-plan.md` phase 3; with 03b v1.0.11).** Since 02b v1.0.20 §3.2 step 4a a slot-station line of quantity n is n one-unit lines sharing `part_of`, so a ticket printed "1 x Naan" n times. Now §3.3: the lines of **one ticket** with the same `part_of` (`order_lines.part_of`, read on the ticket statement; statements unchanged) print as **one row** — units summed ("3 x Naan"), options summed by name ("+ 3 x Raita"), the kitchen note once — at the first part's place. Parts fired in different `FireDispatched` are on different tickets and print on their own. The FIRST slip groups the same way; COMING UP groups planned parts with the same fire time; CANCELLED / MOVED slips stay per part (STAB-5 phase 4 handles voids by count). Marker "⚠️ Changed by v1.0.15 (owner 2026-11-22, STAB-5 phase 3)". Test 1b. No table, job kind, event, error code or migration change. |
| **v1.0.14** | 2026-11-20 | Owner ruling **R-38** (2026-11-20, on the P0.16 Printers page, gap G-36 of `docs/plans/05-gaps.md`), marked "⚠️ Changed by 05 (row P-1, R-38)". Status carried as v1.0.13's. Written against v1.0.13. **(1)** §6.6: `GET /admin/queries/print-config` also returns two additive lists, `zones: [{ zone_id, name, archived }]` and `floors: [{ floor_id, name, archived }]`, read from the branch config (`branchConfig()`, memory) so the Printers page "Bill printers" section can label and add zone and floor routes; **0 extra statements** (still 5). **(2)** §6.13, marked "(R-38 note)": two readings of `SetBillRoute` the spec was silent on, which the integrator already built and the owner accepted — `ref_id` must be `''` for `report` / `default` and non-empty for `zone` / `floor` / `device`, anything else `400 VALIDATION_FAILED`; an archived zone or a revoked device still counts as existing, so its route can be removed. **(3)** §10 test 55 and new test 56, §12.2 rows 6 and 13. No event schema, migration or error code change. 05 v1.0.6 §4.5 row P-1 is not edited (it still names 03c v1.0.11; row targets were never edited in place, a new 05 version carries them). v1.0.13 kept. |
| **v1.0.13** | 2026-11-19 | Owner ruling **R-26** (2026-11-19, on the P0.17 review: the QR ruling was in no spec), marked "⚠️ Changed by 05 (row P-3, R-26)" in §3.6: default QR module size **6** on an 80 mm printer and **4** on a 58 mm printer, chosen by the printer's `paper_width_mm`, not by `doc.width_cols`; a block's own `size` (3–8) wins; the 400 limit counts characters (Unicode code points); the `GS ( k` store command's `pL pH` count the payload's UTF-8 bytes + 3. Where a bad QR block is refused is **not** decided here. Owner ruling **R-35** (2026-11-20), marked "⚠️ Changed by 05 (row P-2, R-35)" in §3.7 and §4.2: `documentJobsStatus` also returns `printer_name`, joined from `printers` in the same statement (1 statement), for 05's bill view `prints[]` and print status. Status carried as v1.0.12's. v1.0.12 kept. |
| **v1.0.12** | 2026-11-19 | Owner ruling **R-22** (2026-11-19, on the P0.16 bill-route gaps), marked "⚠️ Changed by 05 (row P-1, R-22)". Status carried as v1.0.11's (APPROVED, Owner, 2026-11-17, 04 Z3a; the 05 rows P-1–P-5 owner-approved with 05 v1.0, 2026-11-18 16:33 PKT), + R-22 owner ruling 2026-11-19. Written against v1.0.11. **(1)** §3.2, §4.2: the `report` scope is used only for report documents (X / Z); `billPrinterFor` for a report = the `report` route if set, else the `default` route; bills use device → zone → floor → default and never `report`. **(2)** §3.2, §5, §6.13: `ref_id` is `''` (empty, branch level) for `report` and `default`, the entity's id for zone / floor / device. **(3)** §3.2, §5, §6.13: one route per (scope, ref_id), primary key `(scope, ref_id)`; `SetBillRoute` replaces it; `printer_id: null` removes it. **(4)** §3.10, §6.13: permission `manage-devices`. **(5)** §6.13: a zone / floor / device `ref_id` that does not exist → `422 CONFIG_REFERENCE_INVALID { field: 'ref_id', reason: 'not_found' }` (01a §9 code), an unknown `printer_id` → `PRINTER_NOT_FOUND` (§9). **(6)** §3.2, §6.2: archiving a printer in use → `CONFIG_IN_USE` `used_by: { entity: 'station', ids }` when stations use it (unchanged), else `{ entity: 'bill_route (station first when both)', ids: ['<scope>:<ref_id>', …] }`. **(7)** §6.2, §6.6, §6.13, §12.2: `SetBillRoute` 2 statements, `print-config` 4 → 5, `SavePrinter` stays 2. v1.0.11 kept as history. |
| **v1.0.11** | 2026-11-19 | 05 Billing (05 v1.0.1 §4.5 rows P-1–P-5; plan P0.2i), marked "⚠️ Changed by 05 (row P-n)". Status carried from v1.0.10 (APPROVED, Owner, 2026-11-17, 04 Z3a); the 05 rows P-1–P-5 are 05 v1.0 §4.5 text, owner-approved with 05 v1.0 on 2026-11-18 16:33 PKT; numbers as re-taken in 05 v1.0.1; applied by 05 phase 0 task P0.2i. Written against v1.0.10. **P-1** §3.2, §4.2, §5, §6.6, §6.11, §6.13 + hub `0022_bill_routes.sql`: bill routes `bill_routes`, `SetBillRoute` / `BillRouteSet`, `billPrinterFor`, a printer used by a route cannot be archived. **P-2** §3.7, §4.2: `retargetDocumentJob`, `documentJobsStatus`. **P-3** §3.6: QR block (`GS ( k`). **P-5** §3.6, §3.7: `registerDocumentFiller`, the fill block `{ fill, ref, last4 }`. **P-4** §3.6, §4.2: `renderText` moves to `@pos/domain/src/print-render.ts`. v1.0.10 kept as history. |
| **v1.0.10** | 2026-11-17 | Owner, 04 Z3a: reconcile of main v1.0.9 and module-04 v1.0.8; no rule changes. Both were built on v1.0.7: v1.0.8 (module-04, 04 Q-15 / Q-17) prints the MOVED TO STOCK slip for a `moved` void share (test 4b); v1.0.9 (main, client gap sweep Q-48, Q-50, Q-54, Q-57) — `lossy_name` warnings with `name`, Reprint on `has_printer` stations, the Printers page never polls (test 55). Different places; this file carries both, every "⚠️ Changed by" marker kept. v1.0.9 and v1.0.8 kept as history. |
| **v1.0.9** | 2026-11-13 | Owner rulings of the 03b / 03c client gap sweep ("Sab rec", 06:02 PKT; record `docs/plans/03b-client-gaps.md`, G3b-8, -12, -16, -17), marked "⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-nn)". **Q-48** §6.6: `lossy_name` warnings carry the item's `name` (branch-config memory, statements unchanged). **Q-50** §3.5, §8: Reprint on the KDS on **`has_printer`** stations (mode `both` **or `printer`** with an active printer, as built in P0.22), not "`both`" only; KDS rows and Pass takeover rows get it through 03b v1.0.8's `registerLineAction`, frames through `subscribeFrames`. **Q-54** §8: the Printers page never polls (no 5 s re-fetch): load on open, Reload / Refresh buttons, re-read after each own command. **Q-57** §6.10, §8: the printer card shows "{printer} · {problem}" — `values.waiting` is not on the alert view, so `{waiting}` is dropped. Also §8 names the admin page `/admin/printers/` (Q-43, 00 v1.9.2 §8.2). New test 55. Numbered v1.0.9 because module-04 holds v1.0.8 (fold note in Doc). No event schema, migration or error code change. Code: `docs/plans/03b-hub-gaps-plan.md` HK6, `docs/plans/03b-client-plan.md` lane A. |
| **v1.0.8** | 2026-11-12 | Owner ruling **04 Q-15** (b) (20:21 PKT, "haan"; 04 v1.0.3 §4.5 row Q-15), marked "⚠️ Changed by v1.0.8 (04 Q-15)": §1.4 P9, §3.3, §3.5 — the share of a line voided with disposition `moved` (`ItemVoided { disposition: 'moved' }`, written after its `ItemMovedToStock`) prints a **MOVED TO STOCK** slip ("finish cooking, keep"; paper text `MOVED TO STOCK - FINISH & KEEP`, 04 Q-17) instead of CANCELLED; every other void share and every removal still prints CANCELLED. Same `cancel` job kind with `payload.slip = 'moved'`: no new kind, no migration. Test 4b; owner manual check (pilot): how a moved line looks on the KDS to the cook. Code: 04 task p1. |
| v1.0.8 (owner answer) | 2026-11-12 | **04 Q-17 ruled** (owner 20:42 PKT, "filhal tw english mai, par mai esko multi language ma rakhna chahta hu"), marked "⚠️ Changed by v1.0.8 (04 Q-17)": the MOVED TO STOCK slip prints English `MOVED TO STOCK - FINISH & KEEP` (ASCII, like the other slips); test 4b's golden bytes are final. The owner's wish for multi-language slips is recorded as a future feature, §12.7 F-1. |
| **v1.0.7** | 2026-11-12 | Owner ruling **Q-P22b** (a) ("sab rec", PR #84 review), marked "⚠️ Changed by v1.0.7 (owner 2026-11-12, Q-P22b)": §3.8 — `station_notice { kind: 'output', has_printer }` also goes to the point's Pass tablets that hold that station's takeover view, exactly like 03b's `archived` notice; the Pass updates the takeover's `has_printer` from it. Code: task P0.23. |
| **v1.0.6** | 2026-11-12 | Owner rulings ("teeno Rec", 11:00; gaps Q-14, Q-18, Q-20 of `docs/design/inventory/03b-03c-design-brief.md` §7), marked "⚠️ Changed by v1.0.6 (owner 2026-11-12, <id>)". **Q-14** new command `DismissPrintSkip { alert_id }` (§3.7, §3.10, §6.12): a manager closes a `printer_problem { problem: 'ticket_not_built' }` alert (reason `done`), never any other problem; error `ALERT_ALREADY_CLOSED` (§9). **Q-18** §3.2: a config apply that archives or removes a station clears its `station_outputs` printer in the same apply (`StationOutputSet { mode: 'screen', printer_id: null, source: 'config' }`), so `SavePrinter { archived: true }` then succeeds. **Q-20** §3.8: `stationHasPrinter(db, station_ids)` for 03b's `kds_station` `has_printer`, and `station_notice { kind: 'output' }` when it changes. Code: task P0.22. |
| **v1.0.5** | 2026-11-12 | Owner rulings ("sab Rec", 07:39), marked "⚠️ Changed by v1.0.5 (owner 2026-11-12, <id>)". **C3-2** §3.5 suspect recovery kind: a ticket with any suspect `kitchen` / `reprint` job → one `reprint` of the ticket, plus its FIRST slip again if that slip is also suspect; a ticket whose suspects are only slips → its latest slip again. **C3-3** §3.7 `printer_problem { problem: 'ticket_not_built' }` is never auto-closed and is always its own alert. **C4-1** §3.4 step 2: at most one COMING UP per station per 5 minutes. |
| **v1.0.4** | 2026-11-11 | Owner ruling **C1-2** (a), marked "⚠️ Changed by v1.0.4 (owner 2026-11-11, C1-2)": §3.5 CANCELLED slip — a cancel job whose units leave **0** live units prints the whole form `CANCELLED  T7  <n> x Naan`, n = the job's units (02b sends the units actually cancelled, `min(units, live)`); `units: null` keeps the v1.0.3 rule; a partial that leaves units keeps `- n x Naan  k left`. Test 3 follows. |
| **v1.0.3** | 2026-11-11 | Owner rulings (a), marked "⚠️ Changed by v1.0.3 (owner 2026-11-11, <id>)". **B3-2** §3.3 ticket layout: plain options print under their line like option children, `"    + 2 x No onion"` (03b v1.0.3 §4.4 `LineDetail.options`); §3.6 / test 9: the `order_lines` fallback of an exited order reads `options_json` too. Depends on 02b v1.0.7, 03a v1.2.2. **C1-1** §3.2 `SavePrinter`: a later save of an archived printer keeps its first `archived_at`; un-archiving clears it. |
| **v1.0.2** | 2026-11-11 | v1.0.2 (2026-11-11, owner): wording only — 02b's bump is v1.0.6 (AD-15); no behaviour change. Every place that named 03b's 02b bump as v1.0.4 now names v1.0.6, marked "⚠️ Changed by v1.0.2 (AD-15): was v1.0.4" (02b took v1.0.4 and v1.0.5 itself on `module-02b`). |
| **v1.0.1** | 2026-11-11 | Owner-approved gap-sweep rulings (`docs/plans/03b-03c-gaps.md`, all Rec (a)), each marked "⚠️ Changed by v1.0.1 (G-n)". **G-14** §6.10: alert step targets written as `{ kind: 'managers' }` (was the bare string `'managers'`); no behaviour change. **G-7** §2, §3.7, §4.4 H-11, §11 task 16: boot wiring as the code does it — `registerPrintBootSteps()` from `main.ts`, the worker started next to `startTickLoop` after listen (`lib/boot.ts:209`, `:236`); no behaviour change. **G-8** §5, §11 task 22: retention runs from 00's sweeper `purge()` (one call line, like 01d's alerts); no behaviour change. |
| **v1.0** | 2026-11-11 | **APPROVED by the owner** (with 03b v1.0). No content change from v0.2.1. |
| v0.2.1 (owner answer) | 2026-11-11 | OQ-C1 answered: the pilot attaches kitchen printers, so 03c is built and checked before go-live (§12.3). No rule changes. |
| **v0.2.1** | 2026-11-11 | Re-check fixes (§12.6): one suspect rule (Ack line points to §3.5), `COALESCE(last_clean_at, 0)` (N-1); a clean read clears only jobs acked a buffer-drain earlier (N-8); `no_screen` warning (N-3); bumps follow 03b v0.4.1's note. |
| v0.2 | 2026-11-11 | **Targeted check closure (§12.5):** every job acked since the printer's last clean status turns suspect on a bad read (M-3, R-5); recovery re-queues the same kind, one job per ticket (n-9); skips recorded at any station with a printer, alerted when it matters (m-9); Cook can reprint (03b B-1) and `order-tickets` returns `has_printer` (m-6); bumps shared with 03b, Q-1 → 02b v1.0.4 (m-5); no timing asserts (m-7); client additions through 03b's slots (m-10); H-11 narrowed to the post-listen start (n-4); hard write timer (n-5); lost lines and tests restored (n-6). |
| v0.1 | 2026-11-11 | Split from 03b v0.2 §3.6–§3.10, §3.14–§3.15 and their tables, commands, kinds and tests (R-2). Run 2 fixes: write timeout and USB isolation (M-1), suspect jobs reprinted when the printer recovers (M-2, R-5), `printer_problem` details via 03b's D-2 (M-3), "clean or unknown" close (m-1), cancelled kitchen jobs and skipped folds (m-2), admin paths (m-9), Reprint on the Pass card (m-12, R-6), FIFO advances at ack (m-13), 02b v1.0.3 row (m-14), slip units at send + registration order (m-15), n-4, n-7, n-8, n-12. Closure §12.4. |

#### Hostile run 1 fixes (`docs/reviews/03c_v1.0.16_hostile_run1.md`) ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)

| Finding | Resolution |
|---|---|
| B-1 dependencies unwritten, no R26 rows | Depends on names the DRAFTs that now exist: 00 HPA v1.13 (`statusLink(order_id) → { path, url }`, its §4.2 *Exposes* row and M98; the slip prints `.url`), 02b v1.0.25 (`orders.pickup_at_ms`), 03a v1.2.11 (§3.5.8, `T_L = max(pickup, land)`), 05 v1.0.35. 01a v2.11 lacks `takeaway_slip_on_send`: §4.4 rows **TS-1…TS-4** (cloud column, 01b wire, snapshot key, owner page) and **B-TK-1** (01b wire) ask for it; 02b rows **Q-TK-1…Q-TK-4**. The README index is the coordinator's, updated with the approval commit. |
| B-2 client-sent trigger loses the slip | Adopted the reviewer's fix: 02b v1.0.25 `SubmitOrder.takeaway.print_slip?: boolean` (row Q-TK-1); 03c's `queueTakeawaySlipOnSubmit` queues the slip **in the same transaction** (row Q-TK-2), so a retransmit, a timed-out first send and a reload are covered by D32. A queued replay prints only when `now − queued_at ≤ TAKEAWAY_SLIP_REPLAY_MS` (120 000), against the accepted `queued_at`: deterministic. `SubmitOrder`'s result carries `slip` (row Q-TK-3) and the token tile shows "Slip not printed — Print slip" on a miss. `PrintTakeawaySlip` stays for `pay_later` (a Send & pay panel closed unpaid; the client retries with the same `command_id`) and `reprint`. §3.11, §6.14, §8; owner decision D-1. |
| M-1 statement count wrong on the routed path | One 03c-internal statement `slipPrinterRow` returns the route's printer **and** its `paper_width_mm` (`billPrinterFor`'s exported shape unchanged). Counts: command `reprint` ≤ 4, `pay_later` ≤ 5 (the duplicate check); submit hook ≤ 3 (root) / ≤ 4 (addition). §6.14, §12.2, tests 59, 64. |
| M-2 duplicate slips | `printDocument` gains optional `meta.order_id`, stored in `print_jobs.order_id` (existing column, no migration); slip jobs carry the token's root id. `pay_later` → `skipped: 'already_printed'` when a non-cancelled slip job of the root exists (1 statement). `reprint` always prints, with a **REPRINT** line at the top; the client debounces. No event (owner decision D-4). Test 62. |
| M-3 permission scope | Any `take-order` holder at the branch, **scope not applied** (the token queue is a shared counter view, R3; the slip has no money or contact); `requires_approval` reads as allowed (the command is not approvable), as `PrintCheckBill`'s `billAccess` does. Owner decision D-3. Tests 63. |
| M-4 Ready time early / pickup / "cannot disagree" | (1) Any live line of the token with no time (`customerReadyAt = null`) → **no Ready line**. (2) A pickup order (root's `pickup_at_ms`) prints the **pickup time itself**, no padding, while no line lands after it; a late kitchen prints the latest customer time (owner decision D-2). (3) 05 §3.16 now says "same line-time function; the slip shows the token's latest time, the receipt per group". Wording kept on purpose: the slip says "Ready around" (read across the counter), the receipt keeps its approved "Ready ~". Test 58. |
| M-5 cart check bill narrowed | Owner decision **D-7** (BLOCKER-for-approval), default written: the cart shows its total on screen before Send (it already does, from `eta-preview` and the cart's pure `computeBill`); the paper check bill is `PrintCheckBill` on a **sent** token's cart and token view. A paper estimate of an unsent cart (a new `PrintCartEstimate`) is the alternative, not specified. §8; 05 §12.3. |
| M-6 missing tests | Tests 62–66: duplicates, permission, per-code refusals and `VALIDATION_FAILED`, slip-vs-close races both orders, routed statement counts, the submit hook (flag, replay window, savepoint), errors catalogue entry; client tests listed in §8 for the 02b-TK client plan. |
| m-1 root undefined | Root = first of the token's orders by `(placed_at, order_id)`, **cancelled included** (the token's identity and its link); `slip_held` reads the non-cancelled set. Test 60. |
| m-2 partly paid bill | Stated: unbilled = pay-later, so a partly paid or split bill still gets the slip (owner decision D-5). Test 60. |
| m-3 setting overload | The slip **always** shows its token time; `show_part_times_to_customers` stays the receipt's switch only. OQ-C3 closed. |
| m-4 `?????` lines | The slip's branch-name line is left out when more than half its letters map to `?`, logged `print.slip.name_unprintable`. 05's own header lines: unchanged (a preview warning is a later 01a / 05 item). Test 57. |
| m-5 link length | 00 HPA M98: `url` ≈ 70 ASCII characters (QR version 5). The slip drops the QR and the scan lines when the url is not ASCII or longer than 120 characters. Test 57 checks the QR fits 384 / 512 dots at the default module sizes. |
| m-6 formula twice; task edits 05 file | The formula is written once, in §4.2 (`customerReadyAt`'s contract); 05 §3.16 cites it. Task 29 lands only after 03c v1.0.16 and 05 v1.0.35 are both approved. |
| m-7 `ORDER_BILLED` widened | Replaced by `TAKEAWAY_SLIP_NOT_ALLOWED { reason: 'billed' }`. |
| m-8 `print-queue` has no `kind_label` | §6.7: `JOBS_SQL` also returns `json_extract(payload, '$.kind_label') AS kind_label` (same statement). Test 59. |
| m-9 05 #60c unobservable | 05 #60c reworded to "no other `document` job written by the close"; slip jobs now carry `order_id` (M-2). |
| m-10 date format | `dayText(at, utc_offset_ms)` → "24 Nov 2026" (ASCII month names, `render/jobs.ts` `MONTHS`), branch zone from `hubTime`; pinned in test 57. |
| m-11 toasts, offline | Text keys `takeaway.slip.off`, `takeaway.slip.no_printer`, `takeaway.slip.not_printed` (EN / UR); *Print slip* disabled while offline with the usual offline hint. §8. |
| m-12 Roman Urdu keys vs constants | The three Roman Urdu lines are builder constants in `takeaway-slip.ts` (exact text in §3.11); wording stays owner decision D-8. |
| m-13 ruling's `takeaway_slip` pointer | Recorded in D-6 / §5: the ruling names a `takeaway_slip` doc kind; this spec ships a `document` job labelled `Token slip` instead (no migration). The owner confirms the deviation. |

#### Integration pass (02b-TK cross-spec rows)

⚠️ Changed by v1.0.16 (integration, 02b-TK), 2026-11-24; still DRAFT.

| Source row | Change here | Where |
|---|---|---|
| 00 HPA v1.13 M-3; 05a v1.0.7 row P-1 | The slip reads `statusLink(root_order_id)?.url`: `statusLink` returns `{ path, url } \| null`; `null` → no QR and no scan lines, the slip still prints | Depends on, changelog (2), §3.11 QR, §4.1, test 57 |
| 00 HPA v1.13 M-4 (OD-3) | The QR url is on the **public** listener's port `public_status.port` (default `http_port + 1`), not `http_port`; test 57's fixture url is `:3001` | Depends on, §3.11 QR, test 57 |
| 01a v2.11 TS-1 – TS-4; 01b v1.12 B-1 | Rows TS-1 – TS-4 and B-TK-1 marked carried; the TS-2 refusal written in the wire's shape `issues[0].path = 'takeaway_slip_on_send'`; 01a's wording of TS-3 / §4.3 / §4.4 / test 217 ("`PrintTakeawaySlip { reason: 'send' }`") is corrected there to this spec's paths (the submit hook, `pay_later`) | Depends on, §3.11 Setting, §4.1, §4.4 |
| 02b v1.0.25 TK-4 | Q-TK-1 – Q-TK-4 checked: present in 02b v1.0.25 with the same names, payload keys, statement counts and result shape | §4.4 |
| Foundation v1.18 §6.2 | `TAKEAWAY_SLIP_NOT_ALLOWED` (409) appended there (§9 here unchanged) | — |

---

## §1. Header

### 1.1 Stories covered

- **E3 "Ticket printing"** (P1): AC1 (per-station output), AC2 (screen offline → paper, where a printer is attached), AC3 (58 / 80 mm, LAN / USB), edges (printer down never blocks, Done cancels an unsent print, reprint after restart).
- E0 Orders AC4 (reprint, from the KDS and the Pass card); E0 Hardware printers; E5 power (print queue survives restart, D24); E0 Templates AC2 kitchen ticket (fixed layout, G1-14).
- README carried rows :200, :211, :240 #5; 02b §4.3 To 03b ticket rows (token + date, parking, notes verbatim, no zone-served, no COMP, CANCELLED delta, RETURN); 01a :398 on paper; F §5.8 step 5; OQ14.

### 1.2 In scope

Printer and station-output configuration (hub admin); the hub print queue; kitchen tickets per order per station per fire; CANCELLED / FIRST / REPRINT / COMING UP slips; suspect-ticket recovery; paper fallback for dark screens; manual reprint (KDS, Pass card); ESC/POS renderer, LAN and USB transports; `printer_problem` alert; the `printed` tag on screens; the print API for 05; the hub admin "Printers" page. ⚠️ Changed by v1.0.16 (02b-TK R6): the **takeaway token slip** for pay-later takeaway orders: queued in 02b's `SubmitOrder` transaction (`queueTakeawaySlipOnSubmit`) and by the command `PrintTakeawaySlip` (§3.11, §6.14; ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)).

### 1.3 Out of scope

Screens and presence (03b); receipt / bill / Z content and template (05); Urdu-script raster printing (⚠️ Changed by v1.0.16 (02b-TK R6): **no Urdu script on any print**: kitchen tickets, slips, the token slip and 05's documents print PC437 text only; Roman Urdu in ASCII is allowed); the token slip's status page and its signed link (00 Hub Platform Access v1.13); the token slip merged into the receipt (G-11's hand-off idea; ruled out by R6: a paid order gets the receipt only); configurable kitchen ticket template; training-mode printing (E13); reprint on 02b's screens (02b follow-up, R-6).

### 1.4 Decisions log

| # | Decision | Source |
|---|---|---|
| P1 | One kitchen ticket per **order per station per fire**. | Q1 B |
| P2 | Tickets print at **fire**. | Q2 A |
| P3 | Station output `screen` (default: no paper unless the screen is dark and a printer is attached), `both`, `printer` (a station with no screen); hub admin only. **Printers are optional** — nothing in 03b needs one. | Q3, R-1 |
| P4 | Paper fallback when 03b marks a station **dark** and it has a printer: Now as tickets + one COMING UP; every new fire prints until the screen is back. | Q4 A, R-3 |
| P9 | Extra slips: CANCELLED on removal / void of a **printed**, not-done line (⚠️ Changed by v1.0.8 (04 Q-15): a `moved` void share prints MOVED TO STOCK instead, §3.5); FIRST on boost / expedite of a printed, not-done line at a `printer` station (a pull fires an unfired, never-printed line, so it never needs a FIRST slip); no slip for Done. | Q9 |
| P10 | Paper is ASCII-mapped text in PC437. ⚠️ Changed by v1.0.16 (02b-TK R6): this holds for **every** print, 05's included: no Urdu script, no raster text; customer-facing Urdu is Roman Urdu in ASCII. | Q10 A; 02b-TK R6 |
| P15 | ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): **Takeaway token slip** (§3.11) only for a **pay-later** (unbilled) takeaway order: queued in the **`SubmitOrder` transaction** when the client sets `takeaway.print_slip` (*Send · pay later*), or by the staff command `PrintTakeawaySlip` (a Send & pay panel closed unpaid; a reprint); never by a fold or a timer; never for a billed order, so a paid order gets the receipt alone. A `document` job; no new job kind. | 02b-TK R6, G-11; hostile run 1 B-2 |
| P13 | Reprint: the KDS reprints its own station's tickets without PIN; the Pass card reprints by order where the station has a printer (`reprint-ticket`). | Q13 A, R-6 |
| P14 | Generic thermal ESC/POS printers, USB or LAN; LAN preferred (status support); status and code page learned per printer. | OQ-1 |
| D1 | Tickets are a forward-only projection; **`print_jobs` only in `live` mode**; the fold is **total**; a skipped fire at a printer station is recorded and alerted. | G1-1; runs 1–2 |
| D2 | Jobs store references; bytes rendered at send. | G1-2 |
| D3 | An async print worker outside every writer transaction and every tick; **USB I/O in a child process per printer**, never on the hub's thread pool. | G1-3, G1-4; run 2 M-1 |
| D4 | **Ack = whole document written and flushed within the write timeout.** When a status read shows an error, **every job of that printer acked since its last clean status** is suspect; suspects are re-queued (same kind, REPRINT header) when the printer next reports clean (a duplicate is acceptable, a missing ticket is not, D24). | R-5; run 2 M-2; check M-3 |
| D8 | `printer_problem` is an `action` kind (a manager must fix paper, power or cable). | run 1 M-1 |
| D12 | 03c's screen additions (`printed` tag, Reprint) go through 03b's client slots (03b D12); 03c never edits 03b's folders. | check m-10 |

---

## §2. Existing architecture that must not change

- Everything in 03b v0.3 §2, plus: Foundation §5.8 boot steps (step 5 resumes the print queue; F §3 "Print queue … (none)": never synced); D24; R8; 00's `apps/hub/src/lib/boot.ts` boot sequence (listen at `:209`; ⚠️ Changed by v1.0.1 (G-7, owner 2026-11-11): was `:208`); 00 route groups (`/admin/...` with `config: { group: 'admin' }`).
- 03b v0.3: `stationPresence()`, `buildLineDetails`, `pointOfLine`, `devicePoint`, `LineDetail`, `Identifier`; the KDS and Pass clients; projection registration order (02b `orders` → 03b → 03c).
- 01d: `printer_alert_ms` joins `ALERT_CONSTANTS` (row D-3); `AlertDetailsBase.printer_name` / `problem` (03b's row D-2).

---

## §3. Domain rules

### 3.1 Words

- **Ticket** = lines of one order fired at one station by one `FireDispatched`. `ticket_id = fire_event_id + ':' + order_id`.
- **Job** kinds: `kitchen`, `reprint`, `cancel`, `first`, `coming_up`, `document`, `test`. ⚠️ Changed by v1.0.16 (02b-TK R6): unchanged. The takeaway token slip (§3.11) is a `document` job (`meta.kind_label: 'Token slip'`).
- **Has a live kitchen job** = an uncancelled `kitchen` job exists for the ticket (fallback test). **Printed** = an uncancelled `kitchen` or `reprint` job with `sent_at` set (slip test, `printed` tag).
- **Suspect** job = acked after the printer's **last clean status** (`printer_runtime.last_clean_at`) and before a status read that shows offline / paper-end / cover-open / error. Paper running out between two reads is therefore caught at the next read.

### 3.2 Station output and printers (P3, admin session)

- **Printer** (`SavePrinter`): name 1–40 (unique among active); `lan` (`host:port`, IPv4 in 10/8, 172.16/12, 192.168/16; port default 9100) or `usb` (`/dev/usb/lp[0-9]` or a udev symlink `/dev/pos-printer-[a-z0-9-]{1,30}`; install doc: udev rule by USB serial, service user in group `lp`); `paper_width_mm` 58 | 80. Archive refused while a station output uses it (`409 CONFIG_IN_USE`; ⚠️ Changed by 05 (row P-1): or a bill route uses it; ⚠️ Changed by 05 (row P-1, R-22): `used_by: { entity: 'station', ids }` when stations use it (unchanged), else `{ entity: 'bill_route', ids: ['<scope>:<ref_id>', …] }`, station first when both; one check query, §6.2). ⚠️ Changed by v1.0.3 (owner 2026-11-11, C1-1): a save of an already archived printer keeps its first `archived_at`; a save with `archived: false` clears it.
- **Station output** (`SetStationOutput`): `mode` `screen` | `both` | `printer`, `printer_id` (used by `both`, `printer`, and by `screen` for paper fallback), toggles `show_taker`, `show_order_id`. `both` / `printer` without a printer → `400 VALIDATION_FAILED { field: 'printer_id' }`. No row = `screen`, no printer. ⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-18): **a config apply that archives a station, or removes it from the snapshot, releases its printer in the same apply** — 03c's `onBranchConfigApplied(prev, next, tx)` hook (total: an odd shape is logged and skipped, never thrown) appends, inside the apply transaction, one `StationOutputSet { station_id, mode: 'screen', printer_id: null, show_taker, show_order_id, source: 'config' }` per such station whose row holds a printer (1 read of `station_outputs` for the archived ids + the appends). Its pending station jobs then have no printer and follow the existing rule — a station job is sent only to its station's current printer — so they stay unsent and visible in the print queue until a manager cancels them (§6.5) or the station is restored with a printer. With no row left holding it, `SavePrinter { archived: true }` no longer meets `CONFIG_IN_USE` for that station. `StationOutputSet` gains `source: 'admin' | 'config'` (optional, default `'admin'`; additive at v1).
- **Bill routes** ⚠️ Changed by 05 (row P-1): table `bill_routes(scope 'zone' | 'floor' | 'device' | 'report' | 'default', ref_id, printer_id)` (§5, hub migration `0022_bill_routes.sql`); hub admin command `SetBillRoute { scope, ref_id, printer_id | null }` (§6.13) writes `BillRouteSet` (`hub` stream); ⚠️ Changed by 05 (row P-1, R-22): **one route per (scope, ref_id)** (primary key `(scope, ref_id)`; `SetBillRoute` replaces it, `printer_id: null` removes it); `ref_id` is `''` (empty, branch level) for `report` and `default`, and that entity's id for `zone` / `floor` / `device`; the `report` scope is used only for report documents (X / Z) and never for a bill; the `print_config` projection folds it and `print-config` lists the routes (§6.6). A printer used by a route cannot be archived (`409 CONFIG_IN_USE`, `used_by` as in the Printer bullet; ⚠️ Changed by 05 (row P-1, R-22)). Export `billPrinterFor(db, { zone_id?, floor_id?, device_id?, report? })` (§4.2) → the first active of device → zone → floor → default (1 statement); ⚠️ Changed by 05 (row P-1, R-22): for a **report** (`report: true`) it is the `report` route if set (and active), else the `default` route; bills use device → zone → floor → default and never `report`. The Printers page gains a "Bill printers" section.
- Hub admin warnings (`print-config`): `printer` station that also has a screen paired ("screen unused"); **`screen` station with a fallback printer but no paired screen** ("no screen paired — this station is screenless and never falls back to paper; set mode `printer` to print at fire", `no_screen`); a name that loses characters in PC437, skipped fires (§3.3), suspect tickets waiting.
- Config is hub-local: events on `hub` / `branch_id`, projection `print_config` (reset); worker facts in `printer_runtime` (outside the projection, so a `print_config` rebuild keeps them).
- **Station output / printer change:** pending jobs of a station follow its **current** printer at send (`print_jobs.station_id`); `document` and `test` jobs keep their own `printer_id`.

### 3.3 Kitchen tickets (P1, P2, D1)

Projection **`kitchen_tickets`** (forward-only), registered **after** 02b's `orders` and 03b's projections (boot assertion). Folds write `tickets` / `ticket_lines` in both modes (`INSERT OR IGNORE`); `print_jobs` **only when `mode === 'live'`**. **Total**: any unexpected shape → skip, log `print.fold_skipped`, and in `live` mode, when the station has **any** printer (`both`, `printer`, or `screen` with a fallback printer), insert a `print_fold_skips` row (`event_id`, `station_id`, `order_ids`, `reason`). The worker raises `printer_problem { problem: 'ticket_not_built' }` at once for a station that prints at fire, and for a `screen` station when it is (or becomes) dark; the print-config page lists every skip. A skip is never silent where paper could be needed.

*02b T19 exception (recorded):* the fold reads `order_lines.order_id` (immutable after `ItemAdded`) for the fired ids; 02b's projection applies first in both modes (registration order, `projections/registry.ts:47-50, :89-111`).

- **`FireDispatched { station_id, order_item_ids }`** → group by order (1 read); one `tickets` row per order, one `ticket_lines` row per id (multi-row inserts). Live and output `both` / `printer` (1 read) → `kitchen` job per ticket, `job_id = ticket_id + ':kitchen'`.
- **`ItemDone`** / **`ItemServed`** → `ticket_lines.done_at`; **`ItemDoneUndone`** → `NULL`.
- **`ItemRemoved { order_item_id, units? }`** / **`ItemVoided { order_item_id, units }`** on a not-done line of a **printed** ticket (1 read) → `cancel` job `{ ticket_id, order_item_id, units: p.units ?? null }` (`null` = whole line). Units left are rendered **at send** from `order_lines` (D2), so fold order never changes the numbers. Not printed → nothing. ⚠️ Changed by v1.0.8 (04 Q-15): an `ItemVoided` with `disposition: 'moved'` (the share 04 moved to stock; its `ItemMovedToStock` comes just before it) queues the same `cancel` job with **`slip: 'moved'`** in its payload (`{ ticket_id, order_item_id, units, slip: 'moved' }`; `print_jobs.kind` CHECK unchanged, no migration; 0 extra reads — the field is on the event). The rule for *when* a slip prints is unchanged: a printed ticket and a not-done line; a `done` line voided `moved` prints nothing, as before. Every other `ItemVoided` (`wastage`, `staff_meal`, `other`, `null`, or no `disposition` on an old event) and every `ItemRemoved` → no `slip` field → CANCELLED. The moved job counts in `earlier_cancelled` like any cancel job (its units left the line).
- **`OrderBoosted`** / **`ItemsReleased { expedite }`** → `first` job per printed ticket with a not-done affected line, **at a `printer` station** only.
- **`TicketReprinted { ticket_ids }`** → `reprint` job per ticket.
- Slip / reprint job ids: `event_id + ':' + kind + ':' + n`. Cost: ≤ 3 reads + multi-row inserts per event.
- **Re-creating a kitchen job:** the unique index counts only uncancelled kitchen jobs; a new one after a cancel takes `ticket_id + ':kitchen:' + n` (n = count of earlier kitchen jobs + 1). So `UndoDone` after an empty-render cancel, or a manager-cancelled stuck job, can be printed again by fallback.

**Ticket layout (fixed; 32 / 48 columns; ASCII-mapped):**

```
TANDOOR                        1:22 PM
================================
           T4 + T5
DINE-IN  Bilal  #7F3K2Q
** RETURN - REMAKE - was T7 Chicken Karahi **
** FIRST - T12 is eating **
--------------------------------
4 x Naan
3 x Naan - for Chicken Karahi Full
1 x Chicken Karahi (Family Deal)
    + Extra butter
    + 2 x No onion
    NOTE: less spicy
--------------------------------
ORDER NOTE: birthday, bring together
```

⚠️ Changed by v1.0.15 (owner 2026-11-22, STAB-5 phase 3): **split lines** — the ticket's lines with the same `part_of` (02b v1.0.20 §3.2 step 4a; `order_lines.part_of` read on the ticket statement, statements unchanged) print as **one row** at the first part's place: units summed ("3 x Naan", the unsplit line's text), the `+` options summed by name ("Raita" on three parts → "    + 3 x Raita"), the kitchen note once. Only the parts on the **same ticket** group: parts fired at different times are on their own tickets (each fire is a ticket) and print there alone. The same grouping applies to a reprint and to the FIRST slip's lines; COMING UP lists planned parts of one `part_of` with the same fire time as one row; CANCELLED / MOVED slips name the part they cancel, as before.

Content from 03b's `buildLineDetails` (identifier, names, notes, return, order taker). ⚠️ Changed by v1.0.3 (owner 2026-11-11, B3-2): the `+` rows are `LineDetail.options` — option children with no station **and** plain options — each `"    + name"` or `"    + <q> x name"` (quantity > 1). No prices, no COMP, no zone-served lines; live units at render; fire time, 12-hour.

### 3.4 Paper fallback (P4)

Print worker, every 1 s (started after listen):

1. Stations with mode `screen` and a printer, and `stationPresence().get(station).dark === true` (03b §3.6: a screen station with no connected screen for `kds_offline_ms` and lines in Now / Next; screenless stations are never dark — they use mode `printer`).
2. While dark, each loop (1 statement per dark station): every ticket of the station holding a line in `stationView(state, station_id, now).now` with **no live kitchen job** → insert a kitchen job (`INSERT OR IGNORE`); on the first loop of an outage also one `coming_up` job (`station_id + ':coming_up:' + offline_since`) rendered at send from `stationPlan`. ⚠️ Changed by v1.0.5 (owner 2026-11-12, C4-1): **at most one COMING UP per station per 5 minutes** — a new outage that starts within 5 min of the station's last `coming_up` job (by `created_at`) prints none (1 read of `print_jobs` by station and kind, on the first loop only).
3. Screen back (`dark` false) → stop; nothing printed is cancelled; 03c's `printed` frame tags the lines.
4. `both` / `printer` stations print at fire anyway. A `screen` station without a printer relies on 03b's Pass takeover and alert.

### 3.5 Slips, suspect recovery, reprint (P9, P13, D4)

- **CANCELLED:** "CANCELLED  T7  - 1 x Naan  3 left" (units left at send) or "CANCELLED  T7  4 x Naan". ⚠️ Changed by v1.0.4 (owner 2026-11-11, C1-2): a cancel job with `units` that leaves **0** live units at send prints the whole form `CANCELLED  T7  <n> x Naan` with n = the job's `units` (02b's event carries the units actually cancelled, `min(units, live)`); a job with `units: null` (whole line) keeps the rule above; a partial that leaves units keeps `- n x Naan  k left`.
- **MOVED TO STOCK** (⚠️ Changed by v1.0.8 (04 Q-15)): a `cancel` job with `slip: 'moved'` prints a bold first line, text key **`print.slip.moved_to_stock`** (meaning: "moved to stock — finish cooking, keep"); paper text `MOVED TO STOCK - FINISH & KEEP` (English, ASCII, like the other slips; ⚠️ Changed by v1.0.8 (04 Q-17): ruled English (owner 2026-11-12 20:42 PKT, 04 Q-17); other languages: §12.7 F-1) — then the CANCELLED line's body without the word CANCELLED, with the same unit forms: `T7  2 x Chicken Karahi` (whole, or `units` leaving 0 live, C1-2) or `T7  - 1 x Chicken Karahi  1 left` (partial). Stale, suspect and REPRINT rules are the `cancel` job's.
- **FIRST:** "FIRST  T12  2 x Roghni (boost)".
- **REPRINT header** on `reprint` jobs, on restart re-sends, on retries after a partially written job (`is_reprint = 1`), and on suspect re-queues.
- **Stale:** `cancel` / `first` render empty (→ cancelled `stale`) when their line is done / served / gone; `coming_up` older than 10 min at send → cancelled `stale`; `reprint` with no live line → empty.
- **Suspect marking (R-5, D4) — the only suspect rule:** on a status read with an error bit, `UPDATE print_jobs SET suspect_at = now WHERE sent_printer_id = p AND acked_at > COALESCE(last_clean_at, 0) AND suspect_at IS NULL` (1 statement; `sent_printer_id` is stored at send). A new printer, or a hub whose first read after a restart is already bad, therefore marks every acked job of that printer not yet cleared. **A clean read clears only jobs acked a buffer-drain earlier:** it sets `last_clean_at = now − 10 000` (the write timeout; a ticket acked in the last 10 s may still be in the printer's buffer), never moving it backwards.
- **Suspect recovery:** when the status turns clean after a bad reading (or a test print prints), for each ticket with suspect jobs and a live, not-done line the worker inserts **one** recovery job of the **same kind** as the ticket's latest suspect (`kitchen` / `reprint` → `reprint`; `cancel` → `cancel`, so a lost CANCELLED slip comes back as a CANCELLED slip; ⚠️ Changed by v1.0.8 (04 Q-15): the recovery job copies the suspect's payload, so a lost MOVED TO STOCK slip comes back as a MOVED TO STOCK slip), ⚠️ Changed by v1.0.5 (owner 2026-11-12, C3-2): the kind is chosen per ticket — **any** suspect `kitchen` or `reprint` job of the ticket → one `reprint` of the ticket (it shows every live line, so a suspect CANCELLED is covered by it), and if a `first` slip of that ticket is **also** suspect, that FIRST slip is re-sent too (id `ticket_id + ':recover:first:' + last_clean_at`); a ticket whose suspects are **only slips** → its **latest** suspect slip again, same kind (as built); id `ticket_id + ':recover:' + last_clean_at`, `INSERT OR IGNORE`, REPRINT header; then marks the suspects `suspect_resolved_at`. A printer whose status is **unknown** (no DLE EOT answer, USB without proven status) cannot produce suspects: a ticket lost in a power-cycled buffer there is not detected — the print-config page recommends LAN printers with status, and the Pass / KDS reprint covers it by hand.
- **`ReprintTicket { ticket_id? , order_id? }`** (exactly one): station session → own station's tickets (by `order_id`, only its station's tickets of that order); staff → `reprint-ticket` (Cook has it by default, 03b B-1). Writes `TicketReprinted { order_id, station_id | null, ticket_ids }` → `reprint` jobs (live). Nothing live → `result.skipped`.
- **Where the button is:** KDS (~~`both` stations~~ ⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-50): **`has_printer` stations** — output mode `both` or `printer` with an active printer, the `kds_station.has_printer` of 03b §6.14, which is what P0.22 built; own tickets; on each row through 03b v1.0.8's `registerLineAction` with `surface: 'kds'`); ⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-50): **Pass takeover rows** of a `has_printer` station, `surface: 'takeover'` (the call shape is a client rule, `docs/plans/03b-client-plan.md`); **Pass card** — registered through 03b's `registerPassCardAction` slot from 03c's own folder, shown when `order-tickets` reports a ticket with `has_printer`, by order (`reprint-ticket`). Reprint on 02b's screens: 02b follow-up (R-6).

### 3.6 Rendering and ESC/POS

- `Doc = { width_cols?: 32 | 48, blocks: Array<{ text, size?, bold?, align? } | { rule } | { feed } | { cut } | { drawer }> }`; wrap to 32 / 48; long words break. ⚠️ Changed by 05 (row P-3): `DocBlock` gains `{ qr: string (≤ 400), size?: 3–8 }` → ESC/POS `GS ( k` (model 2, error correction M, module size `size`; ⚠️ Changed by 05 (row P-3, R-26): was "default the largest that fits 80 mm / 58 mm, A3 default" — **the default module size is 6 on a printer with `paper_width_mm = 80` (48 columns) and 4 on one with `paper_width_mm = 58` (32 columns), chosen by the target printer's paper width, never by `doc.width_cols`; a block's own `size` (3–8) wins over the default; the 400 limit counts characters (Unicode code points, not UTF-16 units or bytes); the store-data command (`GS ( k pL pH 31 80 48 d1…dk`) carries `pL + pH × 256` = the payload's UTF-8 byte length + 3**); `renderText` prints `[QR] <payload>`; a printer that ignores `GS ( k` still prints the fiscal number line beside it (05 always prints it). ⚠️ Changed by 05 (row P-5): `DocBlock` also gains the fill block `{ fill: block_kind, ref, last4 }`, replaced at **send** (§3.7); `renderText`, pure, prints its `last4`. ⚠️ Changed by 05 (row P-4): `renderText(doc, width_cols)` lives in `@pos/domain/src/print-render.ts` (browser-safe, no `node:*`); the hub imports it from there.
- Mapping: `—` `–` `−` → `-`; `×` → `x`; `·` → space; curly quotes → straight; then PC437; else `?`.
- Encoder (no library): `ESC @`, `ESC a n`, `ESC E n`, `GS ! n`, `GS V 66 0`, `ESC p 0 25 250`, `DLE EOT 1` / `DLE EOT 4` (Epson ESC/POS reference, checked 2026-11-11).
- Render at send: `buildLineDetails` (2 statements), ticket lines + `order_lines` units (1); an order no longer in the engine falls back to `order_lines` and config names (⚠️ Changed by v1.0.3 (owner 2026-11-11, B3-2): the fallback also reads `order_lines.options_json` (02b v1.0.7), so a reprint of an exited order prints its plain options too). Empty `kitchen` / `first` / `cancel` → cancelled, not sent; `reprint` prints every live line.

### 3.7 Print worker and failure rules (R8, D3, D4)

- **Never blocks service:** no command waits; folds only insert, live only, never throw; network and USB I/O never run on the main thread's libuv pool.
- **One FIFO per printer**, advancing **at ack** (never waits for a status read). `test` jobs bypass the FIFO.
- **Send:** render and set `sent_at` in one synchronous step, then:
  - **LAN:** `net.Socket`, connect timeout 3 s, **hard write timer 10 s** from the first byte to `drain` (a `setTimeout` that is not reset by progress — `socket.setTimeout` is an idle timer and a slowly reading printer would never trip it); on expiry `destroy()` → failure path. Timeouts are injected (tests use a fake clock).
  - **USB:** one **child process per USB printer** (`apps/hub/src/print/transport/usb-child.ts`, `child_process.fork`) does the blocking device writes; the parent sends bytes over IPC and waits ≤ 10 s; on timeout it kills the child (`SIGKILL`) and respawns it → failure path. The hub process never opens the device.
- **Ack:** whole document flushed within the timeout → `acked_at`. Suspect marking: §3.5 only.
- **Status reads:** LAN only by default (USB only if its test print proved status), at most once per 10 s per printer, plus right after a failure and while the printer has an open `printer_problem`. Status timeout 2 s, never blocking the FIFO.
- **Retarget** ⚠️ Changed by 05 (row P-2): `retargetDocumentJob(tx, job_id, printer_id)` — a `document` job not acked and not cancelled moves to `printer_id` (`attempts = 0`, `last_error = NULL`); a job being sent is refused `409 PRINT_JOB_NOT_PENDING`. `documentJobsStatus(db, job_ids)` → `[{ job_id, printer_id, printer_name, state: 'waiting' | 'printing' | 'printed' | 'failed' | 'cancelled', last_error }]` (1 statement; ⚠️ Changed by 05 (row P-2, R-35): `printer_name` added, joined from `printers` by the job's current `printer_id` in the same statement — `LEFT JOIN`, so an archived printer still gives its name and a missing row gives `null`).
- **Document filler** ⚠️ Changed by 05 (row P-5): `registerDocumentFiller(block_kind, fn)` (startup). A `Doc` block `{ fill: block_kind, ref, last4 }` is replaced at **send** by `fn(db, ref)` (05: `buyer_id` → the full number from `invoice_buyers`); the filled text is rendered and sent, **never written back** to `print_jobs.payload` (which keeps the block). An unknown kind or a missing row prints `last4`; a filler error is logged with `job_id` only.
- **Failure before a full write:** `attempts + 1`, `last_error`, `is_reprint = 1` if any byte went out, `sent_at = NULL`; retry 2 s, 5 s, then every 10 s, no limit. (A removal folded while `sent_at` was set already queued a CANCELLED slip; the retry then prints the ticket without those units plus the slip — harmless.) Kitchen and slip jobs drain as their lines finish; `document` jobs wait or are cancelled by a manager.
- **`printer_problem`:** raised (dedupe `printer_problem:<printer_id>`) when the head job has failed for ≥ `printer_alert_ms` (30 000), a status error bit appears, or a `print_fold_skips` row names the printer's station; details `{ printer_name, problem }` (03b's D-2). Closed `done` at the next ack with clean **or unknown** status; `obsolete` on archive or when nothing is pending and the status is clean or unknown. ⚠️ Changed by v1.0.5 (owner 2026-11-12, C3-3): a `printer_problem { problem: 'ticket_not_built' }` (fold skip) is **never auto-closed** — not at the next ack, not `obsolete` — only a manager closes it (⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-14): with `DismissPrintSkip`, §6.12; it still expires at day close); it is **always its own alert** (dedupe `printer_problem:ticket_not_built:<print_fold_skips.event_id>`), never absorbed into another open `printer_problem` of the printer, and its own closing never closes the others.
- **Restart (F §5.8 step 5):** 03c registers `registerBootStep('5', resumePrintQueue)` (existing 00 hook, `lib/boot.ts:59-70`; ⚠️ Changed by v1.0.1 (G-7, owner 2026-11-11): registered by a once-guarded `registerPrintBootSteps()` called from `main.ts`, as 01a and 03a register theirs; was "`lib/boot.ts:58-68`, no 00 code change"): `sent_at` set and `acked_at` null → `is_reprint = 1, sent_at = NULL`. Row **H-11** covers only the one 00 code change: start the print worker **after listen** (`lib/boot.ts` after `:209`, next to `startTickLoop` at `:236`, its stop joined in `beat.stop`; ⚠️ Changed by v1.0.1 (G-7, owner 2026-11-11): was "after `:208`"; with the `main.ts` line above and `registerPrint(app, deps)` in `server.ts`, H-11's 00 code change). The worker drains in `created_at` order.
- **Writes outside transactions:** `print_jobs`, `printer_runtime`, `print_fold_skips` updates by the worker are plain statements between transactions; never events, never synced.
- **Cost:** idle loop ≤ 2 statements + 1 per dark station.

### 3.8 `printed` tag on screens

Catch-up part `kds_printed` (station sockets: its station; Pass sockets: their point's stations) `{ order_item_ids }` of printed tickets with lines in Now (1 statement), and frame `printed_lines { station_id, order_item_ids }` after each ack of a `kitchen` / `reprint` job. 03c registers the tag through 03b's `registerLineTag` slot (D12).

- ⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-20): **`stationHasPrinter(db, station_ids)`** (03c export, 1 statement: `station_outputs` ⋈ `printers` where `mode IN ('both','printer')` and the printer is not archived) gives 03b's `kds_station` catch-up its `has_printer`; when a `StationOutputSet` or a `PrinterSaved` changes that value for a station, 03c sends `station_notice { station_id, kind: 'output', has_printer }` after commit to that station's sockets (03b v1.0.6 §3.10, §6.14), so the KDS shows or hides its Reprint action without a refetch. ⚠️ Changed by v1.0.7 (owner 2026-11-12, Q-P22b): **and to the point's Pass tablets that hold that station's takeover view** (staff sockets of the station's point while the station is in `takeover_stations`, the same set as 03b's `archived` notice and its takeover audience, 03b §6.17); the Pass updates that takeover section's `has_printer` from it.

### 3.9 Print API for 05

`printDocument(tx, printer_id, doc, meta?: { kind_label: string, order_id?: string })` → a `document` job in the caller's transaction (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): optional `meta.order_id` is stored in the existing `print_jobs.order_id` column, NULL when absent as today; only the token slip sets it, §3.11; no migration, statements unchanged); unknown / archived → `404 PRINTER_NOT_FOUND`. Drawer kick = a `Doc` with `{ drawer: true }`. Preview: `renderText(doc, width)`.

### 3.10 Permissions

| Action | Station session | Staff session | Admin session |
|---|---|---|---|
| `ReprintTicket` | own station's tickets | `reprint-ticket` (`branch`) | — |
| `GET /queries/order-tickets` | — | `reprint-ticket` | — |
| `DismissPrintSkip` (⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-14)) | — | `force-release-table-lock` (`branch`): the permission that defines 01d's `managers` set, i.e. exactly who receives `printer_problem` | — |
| `SavePrinter`, `SetStationOutput`, `SetBillRoute` (⚠️ Changed by 05 (row P-1, R-22)) (`/admin/commands/`), `POST /admin/print/test`, `POST /admin/print/jobs/:job_id/cancel`, `GET /admin/queries/print-config`, `GET /admin/queries/print-queue` | — | — | `manage-devices` |
| `PrintTakeawaySlip` (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)) | — | `take-order`, **any scope, scope not applied** (the token queue is a shared counter view, R3; the slip carries no money or contact); a `requires_approval` grant reads as allowed (the command is not approvable), as 05's `billAccess`; not granted / denied → `403 PERMISSION_DENIED` (owner decision D-3) | — |

### 3.11 Takeaway token slip (P15) ⚠️ Changed by v1.0.16 (02b-TK R6)

⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): rewritten after hostile run 1 (B-2, M-1–M-4, m-1–m-5, m-10, m-12).

**Pay-later.** A takeaway order is pay-later while its own `orders.billed_at IS NULL` (05 writes `OrdersBilled` at a bill's last close and `OrdersUnbilled` on reopen). A **partly paid** bill (a payment taken, or one split closed) is still pay-later: the slip prints (owner decision D-5). A billed order never gets a slip.

**Trigger 1 — on `SubmitOrder`, in its transaction** (the normal case). 02b v1.0.25 `SubmitOrder.takeaway.print_slip?: boolean` (row Q-TK-1; default `false`). The client sets `true` on **Send · pay later** and leaves it out on **Send & pay**. When it is `true` and the takeaway order is accepted, 02b's script calls **`queueTakeawaySlipOnSubmit(tx, input)`** (03c, §4.2) after its append, in the same writer transaction (row Q-TK-2): a command-time hook, not a fold, the way 05's close calls `printDocument`. The slip job therefore commits and rolls back with the order, and D32 covers every retransmit: a timed-out first send that the drain resends, a reload with "Send again", a double tap (the same `command_id` returns the stored result, no second job).
- **Queued replay:** when the command was queued (02b §3.12: `ctx.queuedAt` is the accepted, clamped `queued_at` of a command sent with `X-Queued-At`), the slip prints only when `now − queued_at ≤ TAKEAWAY_SLIP_REPLAY_MS` (**120 000**, a constant in `@pos/domain`, not a setting), else `skipped: 'replay_late'` (the customer has probably left; the token view's Print slip covers it). It compares two stored times, never the arrival timing, so it is deterministic (AD-32 holds: no wall-clock assert).
- **Never fails the submit:** the hook runs inside a SAVEPOINT; any error rolls back to it, is logged `print.slip.failed` with ids only, and gives `skipped: 'failed'`; the order commits.
- **Result:** `SubmitOrder`'s result gains `slip: { printed, job_id, skipped } | null` (row Q-TK-3; `null` when `print_slip` is not `true`). On `printed: false` with `no_printer`, `failed` or `replay_late` the token tile shows "Slip not printed — Print slip" (§8).
- **Rules applied by the hook:** the setting (`skipped: 'setting_off'`), the replay window, the addition rule below (`slip_held`), the printer (`no_printer`). A root needs no duplicate check (the order is new).
- **Ready time at submit:** the engine state of this transaction does not yet hold the new order, so for the **new order** the hook takes its plan from the submit itself: each `OrderPlaced.groups[]` gives `promise_ms` (= the group's customer time: land + padding) and `target_land_ms`. For an addition, the earlier orders' live lines use `customerReadyAt` on the engine state as it is. For the new order a group's `target_land_ms` is its `land_at` and its `promise_ms` its `ready_at` in the Ready rules below (so the pickup rule reads `target_land_ms ≤ pickup_at_ms`, which 03a v1.2.11's `T_L = max(pickup, land)` makes an equality when on time). A reprint right after the commit gives the same minute (test 65).

**Trigger 2 — `PrintTakeawaySlip` (§6.14).** `reason: 'pay_later'`: a **Send & pay** panel was closed with the bill still open (the customer will pay later). The client sends it once with its own `command_id` and retries with the **same** `command_id` while the page lives, until a 2xx or a 4xx (D32-safe); after a reload or a final failure the tile shows "Slip not printed — Print slip". `reason: 'reprint'`: the token view's **Print slip** on a Due token.

**Send & pay** sends no flag and no command: `CloseSplit` prints the receipt (05 §3.16, unchanged) and it is the only paper.

**Which orders (token).** The token's orders = `orders` with the named order's `(business_date, token)` and `order_type = 'takeaway'` (an addition carries its root's token, 05 row Q-6). The **root** = the first of them by **`(placed_at, order_id)`, cancelled included**: it is the token's identity and its link (00 HPA's status page shows the whole group, root and additions, for any of their links). **Addition rule** (submit hook with `adds_to_order_id`, and `pay_later`): an order that is not the root prints only when every **other non-cancelled** order of the token is billed (the customer then holds a receipt, not a slip); otherwise `skipped: 'slip_held'`. A `reprint` always prints.

**Duplicates.** Every slip job stores the token's **root `order_id`** in `print_jobs.order_id` (`printDocument` `meta.order_id`, §3.9; 05's documents keep NULL, so `kind = 'document' AND order_id IS NOT NULL` is exactly the slips). `pay_later` with a non-cancelled slip job of the root already present → `skipped: 'already_printed'` (1 statement; the table is bounded by its 7-day retention, no index, no migration). A `reprint` always prints and carries a **REPRINT** line at the top, so two slips are told apart at hand-over; the client allows one request in flight. **No event** is written (owner decision D-4): the print history is the job rows (with `order_id`, 7 days) and `print-queue` (§6.7).

**Setting.** **`takeaway_slip_on_send`** (boolean, default **true**), proposed to 01a v2.11 as rows TS-1…TS-4 (§4.4; ⚠️ Changed by v1.0.16 (integration, 02b-TK): carried by 01a v2.11 TS-1 – TS-4 and 01b v1.12 B-1); read as `branchConfig()?.engine_settings.takeaway_slip_on_send ?? true`. Off → the submit flag and `pay_later` print nothing (`skipped: 'setting_off'`); `reprint` prints anyway. Default: owner decision D-6.

**Printer.** One statement, the 03c-internal **`slipPrinterRow(db, { printer_id?, device_id })`**: with a `printer_id`, that printer if active (else the command answers `404 PRINTER_NOT_FOUND`); else the route chain device → default joined with `printers` (as `billPrinterFor`, whose exported shape stays `string | null`), returning `{ printer_id, paper_width_mm }` or nothing. Nothing → `skipped: 'no_printer'`, logged `print.slip.no_printer` with ids (R8). `width_cols` = 32 at 58 mm, 48 at 80 mm; the QR's default module size follows §3.6.

**Layout** (fixed; 32 / 48 columns; every fixed string is ASCII; dynamic text goes through §3.6's mapping):

```
             REPRINT                      (reprint only; bold, centre)
          LAKE CITY BRANCH                (branch name, bold, centre)
              TAKEAWAY                    (centre)
================================
               TOKEN                      (bold, centre)
                 57                       (size 2, bold, centre)
          Aap ka token: 57                (centre)
        Ready around 1:42 PM              (bold, centre; only with a time)
--------------------------------
         PAY AT THE COUNTER               (bold, centre)
       Paise counter par dein             (centre)
--------------------------------
             [QR statusLink]              (only with a link)
   Scan on restaurant Wi-Fi to follow     (centre, wrapped)
   your order
   Order dekhne ke liye scan karein       (centre)
--------------------------------
     #57  1:20 PM  24 Nov 2026            (token, the root's placed time, date; centre)
(feed, cut)
```

- **Branch name:** 00's `provisioned.branch_name` (memory), the value of 05's `{branch_name}`. Empty, or more than half of its letters mapped to `?` (an Urdu-script name), → the line is left out and `print.slip.name_unprintable` is logged (no `?????` line).
- **Token** at text size **2**, the largest `Doc` size (§3.6); no larger ESC/POS size is added (owner decision D-8).
- **Ready time** ("Ready around " + `clock12`), always shown when known, independent of 01a `show_part_times_to_customers` (that switch stays the receipt's): over the token's **non-cancelled** orders' lines that are in the engine and not served (`added` / `cooking` / `done`), every serve mode:
  - if any such line has no time (`customerReadyAt` → `null`: not planned, no booked load, not fired) → **no Ready line** (better none than an early one);
  - **pickup:** when the root's `pickup_at_ms` (02b v1.0.25 `orders.pickup_at_ms`) is set and no line's land (`land_at`) is after it → the **pickup time itself**, no padding (R4: the whole order lands *for* the pickup time; 03a v1.2.11 §3.5.8 targets `T_L = max(pickup, land)`; owner decision D-2);
  - else the **latest** `ready_at` (land + carry + the order's padding): the time the whole token is ready;
  - no line in the engine → no Ready line.
- **QR:** `{ qr: statusLink(root_order_id).url }` (00 HPA v1.13 §4.2, M98: `http://<advertised_host>:<http_port>/t/<order_id>.<mac>`, ≈ 70 ASCII characters, QR version 5; pure, 0 statements). ⚠️ Changed by v1.0.16 (integration, 02b-TK) (00 HPA v1.13 M-3, M-4; 05a v1.0.7 row P-1): the builder reads **`statusLink(root_order_id)?.url`**: `statusLink` returns `{ path, url } | null`, and `null` (status page off: `public_status.enabled` not `true`, no `advertised_host`, a non-ULID root id, or no `status_link_key`) → no QR block and no scan lines, the slip still prints (`status_url: null` to the builder), no log line (a hub with the page off is a normal setup); the url is `http://<advertised_host>:<public_status.port>/t/<order_id>.<mac>` — the **public** listener's port (default `http_port + 1`), never the main `http_port`, which keeps the guest-network guard. A `url` that is not ASCII or is longer than **120** characters (version ≤ 7) → the QR block and both scan lines are left out and `print.slip.link_unprintable` is logged; the slip still prints. The link sits in the stored `Doc` of a hub-only, 7-day print job.
- **Strings:** English lines are text keys `print.slip.takeaway.{reprint, title, token, ready, pay, scan}` ("REPRINT", "TAKEAWAY", "TOKEN", "Ready around {time}", "PAY AT THE COUNTER", "Scan on restaurant Wi-Fi to follow your order"), printed in English (paper is EN only). The Roman Urdu lines are **builder constants** in `takeaway-slip.ts`: `TOKEN_RU = 'Aap ka token: {token}'`, `PAY_RU = 'Paise counter par dein'`, `SCAN_RU = 'Order dekhne ke liye scan karein'` (wording: owner decision D-8).
- **Footer:** `#<token>  <clock12(root placed_at)>  <dayText(root placed_at)>`; `dayText(at, utc_offset_ms)` → "24 Nov 2026" (new, in `render/jobs.ts`, ASCII month names from its `MONTHS`), branch zone from `hubTime`.
- **Never on the slip:** items, prices, totals, the customer's name or phone, staff names, bill or invoice numbers, fiscal data. It is **not a bill document** and **not a fiscal document** (05 v1.0.35 §3.16): no `bill_print_jobs` row, no event, never in an invoice, the fiscal snapshot (05 B19 / B22) or X / Z.
- **Job:** `printDocument(tx, printer_id, doc, { kind_label: 'Token slip', order_id: root_order_id })` (§3.9): a `document` job (its `Doc` stored at queue time), FIFO and retry as usual; not part of suspect recovery (§3.5 recovers tickets): a slip lost to paper-out is reprinted from the token view.
- **Builder:** `buildTakeawaySlipDoc({ reprint, branch_name, token, ready_at_text | null, status_url | null, placed_at_text, date_text }, width_cols)` → `Doc`, pure, `apps/hub/src/print/render/takeaway-slip.ts`.

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 03b | `stationPresence`, `buildLineDetails`, `pointOfLine`, `devicePoint`, `LineDetail`, KDS / Pass clients, D-2 detail fields |
| 03a | `stationView`, `stationPlan`, events |
| 02b | `order_lines`, `orders`, events |
| 01d | `defineAlertKind`, `alerts.raise` / `close`, `printer_alert_ms` (D-3) |
| 01a | `branchConfig()`, `engine_settings.kds_offline_ms` (via 03b) |
| 00 | §2; `lib/boot.ts` step 5 hook (H-11) |
| 04 | `ItemVoided` |
| 00 HPA v1.13 (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)) | §4.2 `statusLink(order_id) → { path, url }` (M98; the slip prints `url`) (⚠️ Changed by v1.0.16 (integration, 02b-TK): `→ { path, url } \| null`; the slip prints `?.url`, the url on `public_status.port`); `provisioned.branch_name` |
| 01a v2.11 (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)) | `engine_settings.takeaway_slip_on_send` (rows TS-1…TS-4, §4.4; absent → true; ⚠️ Changed by v1.0.16 (integration, 02b-TK): carried by 01a v2.11 TS-1 – TS-4) |
| 02b v1.0.25 (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)) | `orders` (`token`, `business_date`, `placed_at`, `billed_at`, `cancelled_at`, `order_type`, `pickup_at_ms`), read only; `ctx.queuedAt` (§3.12); `SubmitOrder` calls `queueTakeawaySlipOnSubmit` (rows Q-TK-1…Q-TK-3); `ORDER_NOT_FOUND` |
| 03a v1.2.11 (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)) | engine state (`lines`, `orders`, `stations[].loads`), read only, for `customerReadyAt`; `OrderPlaced.groups[]` (`target_land_ms`, `promise_ms`) of the submit; §3.5.8 pickup landing |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `printDocument(tx, printer_id, doc, meta?)` | `{ job_id }` | 2 | 05 |
| `renderText(doc, width_cols)` | `string` (⚠️ Changed by 05 (row P-4): moved to `@pos/domain/src/print-render.ts`) | 0 | 05 preview |
| `billPrinterFor(db, { zone_id?, floor_id?, device_id?, report? })` ⚠️ Changed by 05 (row P-1) | the first active printer of device → zone → floor → default; for a report (X / Z): the `report` route if set, else `default` (⚠️ Changed by 05 (row P-1, R-22)) | 1 | 05 |
| `retargetDocumentJob(tx, job_id, printer_id)` ⚠️ Changed by 05 (row P-2) | the retargeted job (§3.7) | — | 05 |
| `documentJobsStatus(db, job_ids)` ⚠️ Changed by 05 (row P-2; R-35) | `[{ job_id, printer_id, printer_name, state, last_error }]` (§3.7; `printer_name` joined from `printers`, R-35) | 1 | 05 |
| `registerDocumentFiller(block_kind, fn)` ⚠️ Changed by 05 (row P-5) | startup registration (§3.7) | — | 05 |
| `Doc` type | §3.6 | — | 05 |
| `customerReadyAt(state, line)` ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | `{ land_at, ready_at } \| null`, pure, `apps/hub/src/print/render/ready-at.ts`. **The one statement of the customer line time** (05 §3.16 cites it): `land_at` = `done_at + carry_ms` when done; else the booked cook end (`line.booked`, else its load's `booked`) + `carry_ms`; else (`started_at ?? fired_at ?? fire_ms`) + `cook_ms` + `carry_ms`; no start → `null`. `ready_at` = `land_at` + the order's padding (`promise_ms − target_land_ms`, its `EngineOrder`); no order → `null`. Exactly 05 v1.0.34 `ready-times.ts` `landOf` + padding | 0 | 03c token slip; 05 receipt ready times |
| `buildTakeawaySlipDoc(input, width_cols)` ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | `Doc` (§3.11), pure | 0 | slip paths |
| `queueTakeawaySlipOnSubmit(tx, { order_id, adds_to_order_id \| null, token, business_date, placed_at, pickup_at_ms \| null, groups: [{ target_land_ms, promise_ms }], device_id, queued_at \| null, now })` ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | `{ printed, job_id, skipped }` (§3.11 trigger 1); never throws (SAVEPOINT) | ≤ 3 root, ≤ 4 addition (token read) | 02b `SubmitOrder` (row Q-TK-2) |
| `TAKEAWAY_SLIP_REPLAY_MS = 120_000` ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | constant, `@pos/domain/src/print.ts` | — | the submit hook |

### 4.3 Carried to other modules

| To | Requirement |
|---|---|
| 05 | Bills, receipts and Z through `printDocument` in the bill-close transaction; template and preview (R12); printer choice from 03c's list; a receipt printer outage never blocks bill close (R8). With no printer attached, 05 decides what the customer gets (screen / no paper). |
| 02b | Reprint on order-taker / cashier screens (follow-up, R-6). |
| 07 | Reprint counts from `TicketReprinted`; print history is hub state, not events. |
| 01e | A station with buttons and no screen: mode `printer`. |
| 00 HPA v1.13 (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)) | No change: its §4.2 already exports `statusLink` with 03c as the consumer; the status page shows the token's whole group (M98 lifetime rule). |
| 01a v2.11 (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)) | Rows TS-1…TS-4 (§4.4). |
| 05 v1.0.35 (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)) | §3.16: the receipt default is unchanged; the token slip is not a bill or fiscal document; the receipt's line time is `customerReadyAt`'s (written once, §4.2). |
| 02b-TK client (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)) | §8: `takeaway.print_slip: true` on *Send · pay later*; `PrintTakeawaySlip` for a Send & pay panel closed unpaid (`pay_later`, retried with the same `command_id`) and for Print slip (`reprint`); Print check bill = 05 `PrintCheckBill { bill_ref: { order_id } }` (exists). |

### 4.4 Changes to other specs (R26) — *Proposed — needs approval*; applied with 03b's rows, one bump per target (03b §4.5 note, task 0d)

| Row | Target → version | Change | Why |
|---|---|---|---|
| F-1 | Foundation → **v1.12** §5.8 | `print_jobs` DDL replaced by §5; step 5: sent-not-acked → `is_reprint = 1`, `sent_at = NULL`, re-send in order; ack = D4 (flushed within timeout; suspect recovery). D24 kept. | D2, D4 |
| F-2 | Foundation → **v1.12** OQ14 | Answered (P14): USB via a child process and a udev symlink, LAN preferred, no library. | P14 |
| H-11 | 00 → **v1.9** (with 03b's H-9, H-10) + code (`apps/hub/src/lib/boot.ts`, R-4) | Start the print worker after listen. Resume uses the existing `registerBootStep('5')` (no change). ⚠️ Changed by v1.0.1 (G-7, owner 2026-11-11): code sites `lib/boot.ts` (worker start / stop after listen), `main.ts` (`registerPrintBootSteps()`), `server.ts` (`registerPrint`), all written once by 03b's phase 0. | §3.7; check n-4 |
| D-3 | 01d → **v1.2.2** (with 03b's D-2; code in 03b task 0c) | `ALERT_CONSTANTS.printer_alert_ms = 30_000`. | §3.7 |
| TS-1 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | 01a → **v2.11** §5.2a + cloud migration (with v2.11's MG-1, next free number) | `branch_engine_settings.takeaway_slip_on_send BOOLEAN NOT NULL DEFAULT true` (existing rows take true); the migration's `config_version` bump delivers it (MG-1 pattern); no audit row. ⚠️ Changed by v1.0.16 (integration, 02b-TK): **carried** by 01a v2.11 TS-1 | §3.11 setting |
| TS-2 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | 01a → **v2.11** §5.2a, §4.4 To 01b | Owner settings wire `BranchEngineSettings` / `BRANCH_ENGINE_SETTING_KEYS` gain `takeaway_slip_on_send: boolean` (not a boolean → `400 VALIDATION_FAILED { field: 'takeaway_slip_on_send' }` (⚠️ Changed by v1.0.16 (integration, 02b-TK): `issues[0].path = 'takeaway_slip_on_send'`, the Foundation §6.1 shape 01a v2.11 TS-2 / 01b v1.12 B-1 use; `null` refused)), written and returned like `returns_boost` (S26 no-op PATCH); recorded in 01b at its next bump (row B-TK-1). ⚠️ Changed by v1.0.16 (integration, 02b-TK): **carried** by 01a v2.11 TS-2 | §3.11 |
| TS-3 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | 01a → **v2.11** §4.3 | Snapshot V4 `engine_settings.takeaway_slip_on_send?: boolean` (optional, R29, the `show_part_times_to_customers` pattern); the builder always sends it; absent → true; read only by 03c's slip paths (the submit hook and `PrintTakeawaySlip { reason: 'pay_later' }`; `reprint` ignores it). ⚠️ Changed by v1.0.16 (integration, 02b-TK): **carried** by 01a v2.11 TS-3 (its text now names these two paths) | §3.11 |
| TS-4 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | 01a → **v2.11** §8 owner app branch settings | Toggle "Print a token slip for pay-later takeaway" (EN / UR keys), next to `show_part_times_to_customers`; a test per row as RO-1…RO-3. ⚠️ Changed by v1.0.16 (integration, 02b-TK): **carried** by 01a v2.11 TS-4 (group **Takeaway counter**; the label is 01a's: "Print a token slip on Send"; test 01a #216) | §3.11 |
| B-TK-1 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | 01b → next bump §6.10 (text) | `BranchEngineSettings.takeaway_slip_on_send: boolean` on the owner settings wire (TS-2). ⚠️ Changed by v1.0.16 (integration, 02b-TK): **carried** by 01b **v1.12** row B-1 (§6.10, test 116) | §3.11 |
| Q-TK-1 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | 02b → **v1.0.25** §6.1, §3.2 step 2 | `SubmitOrder.takeaway.print_slip?: boolean` (optional, default `false`; a key inside `takeaway`, so takeaway only: `takeaway` on another order type is already refused; a non-boolean → `400 VALIDATION_FAILED` path `takeaway.print_slip`). Honoured on a root **and** on an addition (`adds_to_order_id`): 03c's addition rule decides (`slip_held`). Not part of the command hash exclusion list (it is no secret) | §3.11 trigger 1 |
| Q-TK-2 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | 02b → **v1.0.25** §3.2 (new step after the append), §6.1 Statements | When `takeaway.print_slip === true` and the order is accepted: call `queueTakeawaySlipOnSubmit(tx, { order_id, adds_to_order_id, token, business_date, placed_at, pickup_at_ms, groups (the `OrderPlaced.groups` `target_land_ms` / `promise_ms`), device_id, queued_at: ctx.queuedAt, now })` in the same transaction; it never throws. Statements: + ≤ 3 (root) / + ≤ 4 (addition), 0 without the flag | §3.11 |
| Q-TK-3 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | 02b → **v1.0.25** §3.2 step 11 (result) | Result gains `slip: { printed: boolean, job_id: string \| null, skipped: null \| 'setting_off' \| 'slip_held' \| 'replay_late' \| 'no_printer' \| 'failed' } \| null` (`null` without the flag); additive; the D32 stored response carries it | §3.11, §8 |
| Q-TK-4 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1); ⚠️ Changed by v1.0.16 (integration, 02b-TK): Q-TK-1 – Q-TK-4 checked: carried by 02b v1.0.25 §3.2 steps 2b, 10a, 11, §6.1, §8, row TK-4 | 02b → **v1.0.25** §8 (client) | *Send · pay later* sets `takeaway.print_slip: true`; *Send & pay* omits it; the token tile shows "Slip not printed — Print slip" from `slip` (03c §8) | §8 |
| Q-1 | 02b → **v1.0.6** (⚠️ Changed by v1.0.2 (AD-15): was v1.0.4; 02b took v1.0.4 / v1.0.5 itself) §4.3 To 03b (text; v1.0.3 is already APPROVED, 2026-11-10) | "a CANCELLED slip for every `ItemRemoved` on a fired line" → "… on a fired line **whose ticket was printed** (03c §3.3)"; "03b" → "03c" for ticket rows. | run 2 m-14 |

---

## §5. Data model (hub SQLite)

Migration `apps/hub/src/db/migrations/NNNN_print.sql`.

⚠️ Changed by v1.0.16 (02b-TK R6): **no migration.** The token slip is a `document` job, so the `print_jobs.kind` CHECK (`0015_print.sql:50`) and 05's `bill_print_jobs.doc_kind` CHECK (`0023_billing.sql:210`) stay as they are, and nothing else is stored. (A dedicated job kind would need a `print_jobs` table rebuild, `NNNN_print_jobs_takeaway_slip.sql` at the next free number (0028 at the time of writing), and gives the slip nothing it needs; not proposed. ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): the ruling R6 and G-11 name a `takeaway_slip` doc kind; this spec deviates on purpose (a `document` job labelled `Token slip`, `order_id` in the existing column): owner decision D-6.)

```sql
-- print_config projection (reset): PrinterSaved, StationOutputSet (⚠️ Changed by 05 (row P-1): BillRouteSet)
CREATE TABLE printers (
  printer_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  connection TEXT NOT NULL CHECK (connection IN ('lan','usb')), address TEXT NOT NULL,
  paper_width_mm INTEGER NOT NULL CHECK (paper_width_mm IN (58,80)),
  archived_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX printers_name_active ON printers (name) WHERE archived_at IS NULL;        -- CONFIG_NAME_TAKEN

CREATE TABLE station_outputs (
  station_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('screen','both','printer')),
  printer_id TEXT,
  show_taker INTEGER NOT NULL DEFAULT 1 CHECK (show_taker IN (0,1)),
  show_order_id INTEGER NOT NULL DEFAULT 1 CHECK (show_order_id IN (0,1)),
  CHECK (mode = 'screen' OR printer_id IS NOT NULL)
);
CREATE INDEX station_outputs_printer ON station_outputs (printer_id);                        -- CONFIG_IN_USE

-- ⚠️ Changed by 05 (row P-1): hub migration 0022_bill_routes.sql: bill_routes(scope 'zone' | 'floor' | 'device' | 'report' | 'default', ref_id, printer_id); print_config projection (reset): BillRouteSet
-- ⚠️ Changed by 05 (row P-1, R-22): PRIMARY KEY (scope, ref_id); ref_id is '' (empty, branch level) for 'report' and 'default', the entity id for 'zone' | 'floor' | 'device'

-- worker-owned (plain statements)
CREATE TABLE printer_runtime (
  printer_id TEXT PRIMARY KEY,
  supports_status INTEGER CHECK (supports_status IN (0,1)),   -- NULL unknown; learned at test print / first LAN answer
  last_status TEXT, last_status_at INTEGER, last_clean_at INTEGER, last_ack_at INTEGER, last_error TEXT,
  problem_alert_id TEXT
);
CREATE TABLE print_fold_skips (
  event_id TEXT PRIMARY KEY, station_id TEXT NOT NULL, order_ids TEXT NOT NULL,
  reason TEXT NOT NULL, at INTEGER NOT NULL, alerted_at INTEGER
);

-- kitchen_tickets projection (forward-only; jobs only live)
CREATE TABLE tickets (
  ticket_id TEXT PRIMARY KEY, station_id TEXT NOT NULL, order_id TEXT NOT NULL,
  fire_event_id TEXT NOT NULL, fired_at INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('scheduled','early_fill','pulled'))
);
CREATE INDEX tickets_order ON tickets (order_id);                                             -- reprint by order, slips
CREATE INDEX tickets_station_fired ON tickets (station_id, fired_at);                         -- fallback per dark station
CREATE INDEX tickets_fired ON tickets (fired_at);                                             -- retention

CREATE TABLE ticket_lines (
  order_item_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, station_id TEXT NOT NULL, done_at INTEGER
);
CREATE INDEX ticket_lines_ticket ON ticket_lines (ticket_id);

CREATE TABLE print_jobs (                        -- F-1; hub state, never synced
  job_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('kitchen','reprint','cancel','first','coming_up','document','test')),
  printer_id TEXT, station_id TEXT, ticket_id TEXT, order_id TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL, sent_at INTEGER, sent_printer_id TEXT, acked_at INTEGER, cancelled_at INTEGER,
  suspect_at INTEGER, suspect_resolved_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  is_reprint INTEGER NOT NULL DEFAULT 0 CHECK (is_reprint IN (0,1)),
  CHECK (printer_id IS NOT NULL OR station_id IS NOT NULL)
);
CREATE INDEX print_jobs_pending ON print_jobs (created_at) WHERE acked_at IS NULL AND cancelled_at IS NULL;  -- FIFO heads, boot
CREATE INDEX print_jobs_ticket ON print_jobs (ticket_id) WHERE ticket_id IS NOT NULL;                       -- printed / live-job checks
CREATE UNIQUE INDEX print_jobs_one_live_kitchen ON print_jobs (ticket_id)
  WHERE kind = 'kitchen' AND cancelled_at IS NULL;                                                          -- at-fire vs fallback never double
CREATE INDEX print_jobs_suspect ON print_jobs (station_id) WHERE suspect_at IS NOT NULL AND suspect_resolved_at IS NULL; -- recovery
CREATE INDEX print_jobs_acked_by_printer ON print_jobs (sent_printer_id, acked_at) WHERE acked_at IS NOT NULL AND suspect_at IS NULL; -- suspect marking
```

Retention at 00's maintenance hour: acked / cancelled jobs, tickets, ticket lines and resolved skips older than 7 days. ⚠️ Changed by v1.0.1 (G-8, owner 2026-11-11): run from 00's sweeper (`auth/session-sweeper.ts` `purge()`, one call line to `print/retention.ts`, as 01d's `purgeAlerts`); 00 has no retention registry.

---

## §6. Commands, events, queries

**Common:** D32, no PIN, not queueable. Device commands `POST /commands/:name`; admin `POST /admin/commands/:name`; admin routes in the admin group.

### 6.1 `ReprintTicket` — `{ ticket_id? , order_id? }`; station / `reprint-ticket`. Result `{ ticket_ids, skipped }`. Statements 2. Errors `ORDER_NOT_FOUND`, `PERMISSION_DENIED`, `VALIDATION_FAILED`.
### 6.2 `SavePrinter` — admin; writes `PrinterSaved`. Statements 2. Errors `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `VALIDATION_FAILED`. ⚠️ Changed by 05 (row P-1, R-22): on archive, `CONFIG_IN_USE` carries `used_by: { entity: 'station', ids }` when stations use the printer (unchanged), else `{ entity: 'bill_route', ids: ['<scope>:<ref_id>', …] }` (station first when both); the route-in-use check is folded into the station check (one query), so statements stay 2.
### 6.3 `SetStationOutput` — admin; `{ station_id, mode, printer_id, show_taker?, show_order_id? }`; writes `StationOutputSet`. Statements 1. Errors `STATION_NOT_FOUND`, `PRINTER_NOT_FOUND`, `VALIDATION_FAILED`.
### 6.4 `POST /admin/print/test` — `{ printer_id }`; outside the FIFO, ≤ 8 s. `{ printed, status, error }`; updates `printer_runtime`; a clean result triggers suspect recovery. Errors `PRINTER_NOT_FOUND`.
### 6.5 `POST /admin/print/jobs/:job_id/cancel` — Errors `404 PRINT_JOB_NOT_FOUND`, `409 PRINT_JOB_NOT_PENDING`.
### 6.6 `GET /admin/queries/print-config` — `{ printers, station_outputs, bill_routes (⚠️ Changed by 05 (row P-1): `[{ scope, ref_id, printer_id }]`), zones (⚠️ Changed by 05 (row P-1, R-38): `[{ zone_id, floor_id, name, archived }]`), floors (⚠️ Changed by 05 (row P-1, R-38): `[{ floor_id, name, archived }]`), warnings: [{ station_id?, item_id?, kind: 'lossy_name' | 'fold_skipped' | 'suspect_waiting' | 'screen_unused' | 'no_screen' }] }`. Statements 5 (+ 03b's screen-station map, memory) (⚠️ Changed by 05 (row P-1, R-22): was 4; +1 for `bill_routes`). ⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-48): a `lossy_name` warning also carries **`name`** — the name the check found lossy, as in the branch config (`branchConfig()`, memory): the item's, the option's or the deal's name (its `item_id` is the item, option or deal id, as today), so the page can say "'{name}' has letters the printer cannot print". Statements unchanged by that change (5 since 05 row P-1, R-22). ⚠️ Changed by 05 (row P-1, R-38): **`zones` and `floors`** are two additive lists for the Printers page "Bill printers" section, so it can show a zone or floor name beside its route and offer the zone and floor ids to `SetBillRoute` (§6.13). They are read from the branch config in memory (`branchConfig()`, 01a snapshot `floors[]` and `floors[].zones[]`), the same source as `lossy_name`'s names: **0 extra statements — the query stays at 5**. Field names are 01a's and 02a's: `zone_id`, `floor_id` (a zone carries its floor, because 01a makes a zone name unique only within its floor), `name`, and `archived` as 02a §6.17 writes it (01a's snapshot spells a zone's flag `is_archived`; the list maps it to `archived`). `zones` is every zone of every floor in the snapshot, archived zones included (`archived: true`, 01a §4.3 A-1), in the snapshot's order (floor `sort_order`, then zone `sort_order`); `floors` is the snapshot's floors in its order. The snapshot keeps only active floors (01a §4.3), so every listed floor has `archived: false`, as in 02a §6.17 ("every configured floor carries `archived: false`"); the flag stays so the page reads both lists alike. An empty config gives `zones: []`, `floors: []`.
### 6.7 `GET /admin/queries/print-queue` — `{ printers: [{ printer_id, name, status, waiting, suspect, head_error, last_ack_at }], jobs: [...pending, newest 100] }`. Statements 2. ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): each job row also carries `kind_label` (`json_extract(payload, '$.kind_label')` in the same `JOBS_SQL` statement; `null` for non-document jobs), so a slip shows as "Token slip" with its `order_id`; statements unchanged.
### 6.8 `GET /queries/order-tickets?order_id` — `reprint-ticket`. `{ tickets: [{ ticket_id, station_id, station_name, fired_at, printed, has_printer }] }` (`has_printer` = the station's current output has a printer). Statements 2.
### 6.9 Catch-up `kds_printed`, frame `printed_lines` — §3.8.
### 6.10 Kind `printer_problem`

```typescript
defineAlertKind({
  kind: 'printer_problem', family: 'action', subject: 'hub',          // { stream_type: 'hub', stream_id: branch_id }
  steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }],   // ⚠️ Changed by v1.0.1 (G-14, owner 2026-11-11): was `target: 'managers'`
  closes_on: 'owner',
  values_schema: z.object({ printer_id: z.string().min(1), waiting: z.number().int().min(0) }),
  details_schema: AlertDetailsBase.pick({ printer_name: true, problem: true }),   // 03b D-2
  lead_fallback: true, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.printer_problem.card', lock: 'alert.printer_problem.lock' }, request: null,
});                                                                   // dedupe 'printer_problem:' + printer_id
```

⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-57): `values.waiting` stays in `values` only; 01d's alert view has no `values`, so the client card text is "{printer} · {problem}" (the label builder drops the empty `{waiting} waiting` part). The waiting count is shown on the Printers page (`print-queue`, §6.7). No hub change.

### 6.12 `DismissPrintSkip` — `{ alert_id }`; staff session, `force-release-table-lock` (`branch`); not queueable. ⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-14). Reads the alert (1 statement, 01d `alerts` by id): unknown, or not `kind = 'printer_problem'` with `details.problem = 'ticket_not_built'` → `404 ALERT_NOT_FOUND { alert_id }` (a dismiss never closes another problem); already closed → `409 ALERT_ALREADY_CLOSED { alert_id, reason }`; else `alerts.close(ctx, alert_id, 'done')` (01d's owner close; `AlertClosed { reason: 'done' }` with the staff `actor_id`, so the audit shows who dismissed it) and marks its `print_fold_skips` row resolved. Result `{ dismissed: true }`. Statements 2 + 01d's close. No other alert is touched; the skip stays listed (resolved) in `print-config` until retention.

### 6.13 `SetBillRoute` — `{ scope, ref_id, printer_id | null }`; admin; writes `BillRouteSet`; `printer_id: null` removes the route. ⚠️ Changed by 05 (row P-1). ⚠️ Changed by 05 (row P-1, R-22): one route per `(scope, ref_id)` (primary key): a save replaces the existing one; `ref_id` is `''` for `report` and `default`, the entity's id for `zone` / `floor` / `device`. Permission `manage-devices` (as `SavePrinter`, `SetStationOutput`; §3.10). A zone / floor / device `ref_id` that does not exist → `422 CONFIG_REFERENCE_INVALID { field: 'ref_id', reason: 'not_found' }` (01a §9); a `printer_id` that does not exist or is archived → `404 PRINTER_NOT_FOUND` (§9). Statements 2 (reference check + upsert / delete). Errors `CONFIG_REFERENCE_INVALID`, `PRINTER_NOT_FOUND`, `VALIDATION_FAILED`. (R-38 note) ⚠️ Changed by 05 (row P-1, R-38), readings of what R-22 left silent, as built and accepted by the owner: **(a)** the shape of `ref_id` is checked before any read: it must be `''` for `report` and `default`, and non-empty for `zone`, `floor` and `device`; anything else → `400 VALIDATION_FAILED` (a shape error, so not `CONFIG_REFERENCE_INVALID`, which is only for an id that has the right shape and is not found). **(b)** An **archived zone** or a **revoked device** still counts as existing for the reference check, so a route that points at one can be removed (`printer_id: null`) and replaced; only an id the branch has never had → `422 CONFIG_REFERENCE_INVALID { field: 'ref_id', reason: 'not_found' }`. The statement count (2) is unchanged.

### 6.14 `PrintTakeawaySlip` — `{ order_id, reason: 'pay_later' | 'reprint', printer_id? }` ⚠️ Changed by v1.0.16 (02b-TK R6)

⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): `reason: 'send'` is now `'pay_later'` (a Send & pay panel closed unpaid); the *Send · pay later* slip rides on `SubmitOrder` (§3.11 trigger 1).

Staff session, `POST /commands/print-takeaway-slip`, `take-order` with no scope check (§3.10); D32 (a retransmit returns the stored result and queues nothing); not queueable (a print needs the hub). **Script:**
1. Zod: `order_id` 1–64 characters, `reason` in the enum, `printer_id` optional 1–64 → else `400 VALIDATION_FAILED`.
2. Permission (§3.10) → `403 PERMISSION_DENIED`.
3. **Read the token** (1 statement): the named order `LEFT JOIN` the orders of its `(business_date, token)` with `order_type = 'takeaway'` (index `orders_token_day`), each with `order_id`, `placed_at`, `billed_at`, `cancelled_at`, `pickup_at_ms`; the named order's own `order_type`, `cancelled_at`, `billed_at`. A non-takeaway order has no token, so only its own row returns.
4. Refusals, in this order: no row → `404 ORDER_NOT_FOUND { order_id }`; `order_type ≠ 'takeaway'` → `409 TAKEAWAY_SLIP_NOT_ALLOWED { order_id, reason: 'not_takeaway' }`; `cancelled_at` set → `{ reason: 'cancelled' }`; `billed_at` set → `{ reason: 'billed' }` (the bill is closed; the customer has the receipt).
5. Root = first by `(placed_at, order_id)`, cancelled included (§3.11).
6. `pay_later` only (0 statements): `takeaway_slip_on_send` off → `skipped: 'setting_off'`; not the root and another non-cancelled order of the token unbilled → `skipped: 'slip_held'`.
7. `pay_later` only: a non-cancelled `document` job with `order_id` = root exists (1) → `skipped: 'already_printed'`.
8. `slipPrinterRow(db, { printer_id, device_id: <session device> })` (1): a given `printer_id` not active → `404 PRINTER_NOT_FOUND { printer_id }`; no route → `skipped: 'no_printer'` (logged with ids).
9. Build (memory: engine state, branch config, `statusLink`; `reprint: reason === 'reprint'`) → `buildTakeawaySlipDoc` → `printDocument(tx, printer_id, doc, { kind_label: 'Token slip', order_id: root })` (2).

**Result:** `{ printed: boolean, job_id: string | null, skipped: null | 'setting_off' | 'slip_held' | 'already_printed' | 'no_printer' }`. **Statements:** `reprint` ≤ **4** (1 token + 1 printer + 2 print); `pay_later` ≤ **5** (+ 1 duplicate check); a skip at step 6 → 1; `already_printed` → 2; `no_printer` → 2 (`reprint`) / 3 (`pay_later`); a refusal at step 4 → 1. **Errors:** `VALIDATION_FAILED`, `PERMISSION_DENIED`, `ORDER_NOT_FOUND`, `TAKEAWAY_SLIP_NOT_ALLOWED`, `PRINTER_NOT_FOUND`. **No event** (owner decision D-4; the job row carries `order_id`, §3.11); the job shows in `print-queue` with `kind_label` "Token slip" (§6.7).

**Race with a close** (single writer, either order): slip then `CloseSplit` → a slip and then the receipt (harmless: the slip says pay, the customer paid); `CloseSplit` then slip → `TAKEAWAY_SLIP_NOT_ALLOWED { reason: 'billed' }`.

### 6.11 Events (`schema_version` 1)

| Event | Stream / id | Payload | Written by |
|---|---|---|---|
| `TicketReprinted` | order / order_id | `{ order_id, station_id \| null, ticket_ids }` | `ReprintTicket` |
| `PrinterSaved` | hub / branch_id | `{ printer_id, name, connection, address, paper_width_mm, archived }` | `SavePrinter` |
| `BillRouteSet` ⚠️ Changed by 05 (row P-1) | hub / branch_id | `{ scope, ref_id, printer_id \| null }` | `SetBillRoute` |
| `StationOutputSet` | hub / branch_id | `{ station_id, mode, printer_id \| null, show_taker, show_order_id, source?: 'admin' \| 'config' }` (⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-18): `source`) | `SetStationOutput`; the config-apply hook (Q-18) |

WS frame `printed_lines` joins `WsServerMessage`.

---

## §7. Cross-cutting

| Item | Rule | Why |
|---|---|---|
| I/O isolation | LAN sockets with timeouts; USB in killable child processes | A stuck printer never blocks the hub (R8) |
| Timeouts | connect 3 s, write 10 s, status 2 s, test 8 s | Every failure reaches the alert |
| Address validation | private IPv4; `lp` device or `/dev/pos-printer-*` | No sockets to the internet, no arbitrary files |
| Logging | `print.sent`, `print.acked`, `print.suspect`, `print.failed`, `print.fold_skipped`, `print.fallback.*` | Install day, rush |
| Retention | 7 days, maintenance hour | Hub disk |
| No env var; no npm dependency | Node `net`, `child_process` only | YAGNI |

---

## §8. Client contract

- **Hub admin "Printers"** (`apps/client/src/features/admin/printers/`, admin session): printers (add, edit, archive, test), station outputs + toggles, print queue (cancel, suspects), warnings. ⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-43): its own client entry served at **`/admin/printers/`** (group `admin-page`, as `/admin/stock/`), reached from 00's admin side-nav item and home tile (00 v1.9.2 §8.2). ⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-54): **no timer** — the page reads `print-config` / `print-queue` when it opens, on its Reload / Refresh buttons, and once after each of its own commands (save, archive, test, cancel); the design brief's "re-fetch every 5 s while open" is void (the owner's no-polling rule).
- **KDS** (03b's entry): Reprint on ~~`both` stations'~~ ⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-50): **`has_printer` stations'** own tickets and the `printed` tag, both through 03b's slots from `apps/client/src/features/print/` (row action `registerLineAction`, frames `kds_printed` / `printed_lines` / `station_notice` through `subscribeFrames`, re-render through `notifySlots`; 03b v1.0.8 §8).
- **Pass card** (03b's Pass screen): Reprint by order where `has_printer`, and the `printed` tag, through the same slots. ⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-50): Pass **takeover rows** of a `has_printer` station get the row action too (`surface: 'takeover'`).
- ⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-57): **printer alert card** "{printer} · {problem}" (no waiting count, §6.10).
- ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): **Takeaway (02b-TK client; not a 03c folder):** *Send · pay later* sends `SubmitOrder` with `takeaway.print_slip: true` (row Q-TK-4); its result's `slip` with `printed: false` and `no_printer`, `failed` or `replay_late` → the token tile shows "Slip not printed — Print slip" (`takeaway.slip.not_printed`); `setting_off` and `slip_held` show nothing. *Send & pay* omits the flag; when its pay panel is closed with the bill still open, the client sends `PrintTakeawaySlip { order_id, reason: 'pay_later' }` once and retries with the **same** `command_id` while the page lives until a 2xx or a 4xx; a final failure or a reload → the same tile hint. The **token view** shows **Print slip** on a **Due** token (`reason: 'reprint'`, the token's newest order), one request in flight (debounced), **disabled while offline** with the usual offline hint (the command is not queueable). **Print check bill** = 05 `PrintCheckBill { bill_ref: { order_id } }` (05 §6.3, exists, no hub change) on every token with an unpaid bill and on the cart of a **sent** token; an unsent cart shows its total on screen only (owner decision D-7). `TAKEAWAY_SLIP_NOT_ALLOWED { reason: 'billed' }` → the token turned Paid: refresh, hide the action. Toasts are text keys `takeaway.slip.off`, `takeaway.slip.no_printer` (EN / UR); errors through `errors.<code>`. **Client tests (02b-TK client plan):** the flag on the two buttons; the tile hint per `skipped`; `pay_later` retry with one `command_id`; the debounce; the offline disable; the `billed` refresh.

---

## §9. Error catalogue additions

| Code | HTTP | Details | When |
|---|---|---|---|
| `PRINTER_NOT_FOUND` | 404 | `{ printer_id }` | unknown or archived printer |
| `PRINT_JOB_NOT_FOUND` | 404 | `{ job_id }` | cancel of an unknown job |
| `PRINT_JOB_NOT_PENDING` | 409 | `{ job_id, state }` | cancel of an acked / cancelled job |
| `ALERT_ALREADY_CLOSED` | 409 | `{ alert_id, reason }` | `DismissPrintSkip` of a closed alert (⚠️ Changed by v1.0.6 (owner 2026-11-12, Q-14)) |
| `TAKEAWAY_SLIP_NOT_ALLOWED` | 409 | `{ order_id, reason: 'not_takeaway' \| 'cancelled' \| 'billed' }` | `PrintTakeawaySlip` for a dine-in / parking order, a cancelled order, or a billed order (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): `billed` replaces the reuse of 02b's `ORDER_BILLED`, m-7) |

---

## §10. Tests (`apps/hub/test/print/*.test.ts`)

Tickets and slips
1. Golden bytes 32 / 48: item, child at another station, deal part, option child, kitchen note, order note, token with date, parking, RETURN with old item and table, FIRST; no prices / COMP / zone-served; mapping of `—` `×` `−`.
1b. ⚠️ Changed by v1.0.15 (owner 2026-11-22, STAB-5 phase 3): naan ×3 split on a slot station (`N`, `N-p2`, `N-p3`, `part_of: N`) with a plain option and a kitchen note, all three fired in one `FireDispatched` → one ticket row "3 x Naan", "    + 3 x <option>", the note once; a second fire of a fourth part → its own ticket "1 x Naan"; two separate cart lines (no shared `part_of`) stay two rows; a FIRST slip on the grouped parts prints one row with the summed units.
2. One fire, two orders → two tickets; `both` → two kitchen jobs in the same transaction; `screen` → none.
3. Partial removal of a printed line prints "- 1 x Naan  3 left" (02b run 4 M-5), whichever projection folds first; whole → whole-line CANCELLED; unprinted → no slip, ticket renders without the units. ⚠️ Changed by v1.0.4 (owner 2026-11-11, C1-2): a removal / void with `units` that leaves 0 live units → `CANCELLED  T7  <units> x Naan` (no "0 left").
4. Void of a printed, not-done line → CANCELLED; done → nothing.
4b. ⚠️ Changed by v1.0.8 (04 Q-15): `ItemMovedToStock` + `ItemVoided { disposition: 'moved' }` of a printed `cooking` line → one MOVED TO STOCK slip (golden bytes 32 / 48 of `MOVED TO STOCK - FINISH & KEEP`), no CANCELLED; a partial move (2 of 4) → `- 2 x … 2 left` under the MOVED header; one 04 void of a deal with a moved part and a wastage part → MOVED for the moved part, CANCELLED for the other; `wastage` / `staff_meal` / `other` / `null` / absent `disposition` and `ItemRemoved` → CANCELLED (test 4 unchanged); a `done` line moved → nothing; a suspect MOVED slip recovers as a MOVED slip (test 25).
5. Boost on a printed ticket at a `printer` station → FIRST; `both` / `screen` → none; a pull never yields FIRST.
6. Done before send → empty render → cancelled; then `UndoDone` during fallback → a new kitchen job `…:kitchen:2` prints.
7. 500 historical fires with no checkpoint → boot → tickets folded, 0 jobs; same after a restore.
8. Corrupt `station_outputs` or a fire id missing from `order_lines` → fire still commits; `print_fold_skips` row; `printer_problem { problem: 'ticket_not_built' }` at once at a `both` station; at a `screen` station with a printer only when it goes dark.
9. `ReprintTicket` from a KDS (own station only, by order → its station's tickets) and by a **Cook** on a Pass tablet (default grant); REPRINT header; current table; exited order prints from `order_lines` (incl. plain options from `options_json`, ⚠️ Changed by v1.0.3 (owner 2026-11-11, B3-2)); `order-tickets` reports `has_printer`.
9b. **Render vs removal race:** fake printer whose connect is delayed; a removal committed after the render sees the ticket printed and queues the CANCELLED slip.
10. Projection registration order: 02b `orders` → 03b → 03c (boot assertion).
Worker
20. LAN fake printer: written + drained → acked; FIFO advances without waiting for status.
21. **LAN printer that stops reading** (and one that reads 1 byte a second): with an injected clock, the job fails at the hard 10 s timer, retries, `printer_problem` at 30 s.
22. **USB fake device that blocks writes:** the child is killed at the injected timeout and respawned; a PIN login on the hub **resolves** while the child is blocked (no latency number in the gate; latency is a manual check, task 28).
23. Two printers: one down never delays the other.
24. Restart with sent-not-acked → resent once with REPRINT.
25. **Suspect window:** clean read → 3 jobs acked → paper-end read → all 3 suspect; **no clean read yet** (new printer) → jobs acked → paper-end read → all suspect; clean read 2 s after an ack → that job stays inside the window and turns suspect on a paper-end read 5 s later; status clean again → one REPRINT per ticket with a live line (a done line's ticket is not reprinted); a suspect CANCELLED slip comes back as a CANCELLED slip; two suspects on one ticket → one recovery job.
26. Unknown-status printer: acks on flush; never suspect; alert closes on ack.
27. Test print bypasses a stuck head; a clean test triggers suspect recovery.
28. Stale `cancel` / `first` / `coming_up` cancelled when the printer returns.
29. Station output changed → pending station jobs follow; `document` stays; a `print_config` rebuild keeps `printer_runtime`.
30. Encoder bytes; partial write → retry with REPRINT.
Fallback
40. `screen` + printer, 03b marks dark: Now tickets + COMING UP; new fires print; screen back → stop; `printed_lines` tags.
41. Slow printer (5 s per job) during 10 s dark → one kitchen job per ticket.
42. Idle loop statements ≤ 2 + 1 per dark station.
Config and API
50. `SavePrinter` validation, names, archive in use; admin route only.
51. `SetStationOutput` `both` without printer → `VALIDATION_FAILED`.
52. Cancel job → `PRINT_JOB_NOT_FOUND` / `PRINT_JOB_NOT_PENDING`.
53. `printDocument` in a caller's transaction; rolled back with it.
54. `printer_problem` registers at boot; its details survive append (D-2).
55. ⚠️ Changed by v1.0.9 (owner 2026-11-13, Q-48): `print-config` `lossy_name` warnings carry `name` equal to the config name of the lossy item, option and deal (one of each in the fixture, e.g. an Urdu-script item name); other warning kinds carry no `name`; statements still 4. ⚠️ Changed by 05 (row P-1, R-38 note): statements are **5** since R-22 (the "still 4" above predates it); `print-config` also returns `zones` and `floors` from the branch config — the fixture has two floors, three zones, one of them archived (`archived: true`, still listed), each item `{ zone_id, name, archived }` / `{ floor_id, name, archived }` with no other key, every floor `archived: false`, snapshot order; an empty config gives two empty lists; the statement count is 5 with or without them (0 extra).
56. ⚠️ Changed by 05 (row P-1, R-38 note): `SetBillRoute` `ref_id` shape — `report` / `default` with a non-empty `ref_id`, and `zone` / `floor` / `device` with `''`, → `400 VALIDATION_FAILED` before any read; an archived zone and a revoked device are accepted, saved and removed (`printer_id: null`); an unknown id → `422 CONFIG_REFERENCE_INVALID { field: 'ref_id', reason: 'not_found' }`; statements 2.

Takeaway token slip (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1))
57. Golden bytes 32 / 48 of the slip: branch name, `TAKEAWAY`, `TOKEN`, the number at size 2, `Aap ka token: 57`, `Ready around 1:42 PM`, `PAY AT THE COUNTER`, `Paise counter par dein`, the QR block of a fixture `statusLink(...).url` (`http://192.168.10.2:3000/t/<26>.<16>`; ⚠️ Changed by v1.0.16 (integration, 02b-TK): `http://192.168.10.2:3001/t/<26>.<16>`, the public port `http_port + 1`), both scan lines, the footer `#57  1:20 PM  24 Nov 2026` (`dayText`), feed, cut; every byte of the fixed text < 0x80; no item, price, name or phone; `renderText` shows `[QR] <url>`; the reprint variant starts with `REPRINT`. Variants: a 121-character or non-ASCII url → no QR, no scan lines, a log line; ⚠️ Changed by v1.0.16 (integration, 02b-TK): `statusLink` → `null` (status page off) → no QR, no scan lines, no log line, the rest of the slip unchanged; an empty branch name, and an Urdu-script branch name (more than half `?`) → no name line and `print.slip.name_unprintable`; a name with one non-PC437 letter → printed with one `?`. The QR at the default module size fits 384 dots (58 mm) and 512 dots (80 mm).
58. Ready time: together and as-ready lines of a root and an addition → the latest `ready_at`; one live line with no time (unplanned) → no Ready line; a pickup order whose lines land at or before the pickup → the pickup time exactly (no padding); a pickup order whose karahi lands after it → the latest `ready_at`; every line served → no Ready line; `show_part_times_to_customers` off → the Ready line still prints. `customerReadyAt` returns exactly v1.0.34's `landOf` + padding on the 05 #92–#97b fixtures and on a line with no start (`null`).
59. `PrintTakeawaySlip` happy path: `reprint` on an unbilled root → one `document` job, `kind_label 'Token slip'`, `print_jobs.order_id` = root, on the device's bill route, else `default`; a payload `printer_id` wins; an archived `printer_id` → `404 PRINTER_NOT_FOUND`; no route → `{ printed: false, skipped: 'no_printer' }`, success, a log line with ids; a retransmit (same `command_id`) → the same result, no second job; `print-queue` lists the job with `kind_label: 'Token slip'` and its `order_id`.
60. Refusals and skips: unknown → `404 ORDER_NOT_FOUND`; dine-in / parking → `409 TAKEAWAY_SLIP_NOT_ALLOWED { reason: 'not_takeaway' }`; cancelled → `{ reason: 'cancelled' }`; billed → `{ reason: 'billed' }`; after `ReopenBill` (`OrdersUnbilled`) → prints again; a partly paid bill (one split closed) → prints; `pay_later` with the setting off → `setting_off`, no job, while `reprint` prints; `pay_later` for an addition with an unbilled root → `slip_held`; with the root billed (a new bill on the key, 05 #44e) → prints, the Ready time over the token's live lines, the QR of the root's link; a **cancelled root** stays the root (same QR) and an addition with the other orders billed prints; two orders with the same `placed_at` → the smaller `order_id` is the root. `VALIDATION_FAILED`: `reason: 'send'`, a 65-character `order_id`, a missing `order_id`.
61. **Send & pay prints the receipt alone:** `SubmitOrder` (takeaway, no `print_slip`) → `AddPayment` → `CloseSplit` → one receipt `document` job (05 §3.16), no Token slip job; nothing is queued on `OrderPlaced` by any fold.
62. Duplicates (M-2): two `pay_later` commands with different `command_id`s → one job, the second `skipped: 'already_printed'`; `SubmitOrder` with the flag then `pay_later` → `already_printed`; a cancelled (manager-cancelled) slip job does not count; two `reprint`s → two jobs, both with `REPRINT`.
63. Permission (M-3): a cashier with `take-order` scope `own_tables` reprints a token another cashier placed → prints; `requires_approval` grant → prints; `not_granted` / denied → `403 PERMISSION_DENIED`.
64. Statements (`statementCounter`): `reprint` routed = 4, with `printer_id` = 4; `pay_later` routed = 5; `setting_off` / `slip_held` = 1; `already_printed` = 2; `no_printer` = 2 / 3; a refusal = 1; submit hook root = 3, addition = 4, flag absent = 0.
65. **Submit hook** (row Q-TK-2): `SubmitOrder { takeaway: { print_slip: true } }` live → one slip job in the order's transaction and `slip.printed: true`; its Ready line equals a `reprint` right after commit (same minute); the order rolled back (a later validation error in the same script) → no slip job; a retransmit → the stored result, no second job; queued with `queued_at` 60 s before acceptance → prints; 180 s → `skipped: 'replay_late'`; the setting off → `setting_off`; an addition with an unbilled root → `slip_held`; no route → `no_printer`, the order commits; a builder that throws (injected) → the order commits, no job, `skipped: 'failed'`, `print.slip.failed` logged; `print_slip` on a dine-in submit → `400 VALIDATION_FAILED` (02b's `takeaway` key rule).
66. Races and catalogue: slip then `CloseSplit` in two writer turns → slip and receipt; `CloseSplit` then slip → `billed`; `TAKEAWAY_SLIP_NOT_ALLOWED` is in `packages/domain/src/errors.ts` with 409 and in the F §6.2 list (catalogue test).

### Acceptance

| Story AC | Test |
|---|---|
| E3-PRT AC1 | 2, 51 |
| E3-PRT AC2 | 40, 41 |
| E3-PRT AC3 | 1, 20, 22, 30 |
| E3-PRT edges | 21, 22, 6, 24, 25 |
| E0-ORD AC4 | 9 |
| 02b To 03b ticket rows | 1, 3, 4 |
| 02b-TK R6 token slip (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1)) | 57–66 |

---

## §11. Build order (after 03b's hub tasks; one task per commit, TDD)

| # | Task | Files | Spec |
|---|---|---|---|
| — | Upstream rows: applied by 03b's tasks 0c (D-3 code) and 0d (every bump); none here. | — | §4.4 |
| 1 | Error codes | `packages/domain/src/errors.ts` | §9 |
| 2 | Events (3), `printed_lines` frame, `Doc` type | `packages/events/src/`, `packages/domain/src/print.ts` | §6.11, §3.6 |
| 3 | Migration | `apps/hub/src/db/migrations/NNNN_print.sql` | §5 |
| 4 | Projection `print_config` | `apps/hub/src/print/config-projection.ts` | §3.2 |
| 5 | `SavePrinter`, `SetStationOutput` | `apps/hub/src/print/commands/` | §6.2–6.3 |
| 6 | Kind `printer_problem` (module top level) | `apps/hub/src/print/kinds.ts` | §6.10 |
| 7 | Projection `kitchen_tickets`: tickets, live-only jobs, total fold, skips (registration line after 03b's in `lib/boot.ts`) | `apps/hub/src/print/tickets-projection.ts`, `apps/hub/src/lib/boot.ts` | §3.3 |
| 8 | Slips (cancel, first), kitchen re-create ids | same | §3.3, §3.5 |
| 9 | `ReprintTicket` | `apps/hub/src/print/commands/` | §3.5 |
| 10 | Doc, mapping, ticket / slip / coming-up builders (⚠️ Changed by 05 (row P-4): `renderText` is `packages/domain/src/print-render.ts`, not here) | `apps/hub/src/print/render/` | §3.3, §3.6 |
| 11 | ESC/POS encoder | `apps/hub/src/print/escpos.ts` | §3.6 |
| 12 | LAN transport + fake printer | `apps/hub/src/print/transport/lan.ts` | §3.7 |
| 13 | USB child process transport + blocking fake device | `apps/hub/src/print/transport/usb-child.ts`, `usb.ts` | §3.7 |
| 14 | Worker: FIFO, synchronous render + `sent_at`, ack, timeouts, retry, stale / empty cancel | `apps/hub/src/print/worker.ts` | §3.7 |
| 15 | Status reads, suspect marking and recovery, `printer_problem` raise / close, skip alerts | `apps/hub/src/print/status.ts` | §3.5, §3.7 |
| 16 | `resumePrintQueue` via `registerBootStep('5')`; H-11 worker start after listen | `apps/hub/src/print/boot.ts` (⚠️ Changed by v1.0.1 (G-7, owner 2026-11-11): the `lib/boot.ts`, `main.ts`, `server.ts` lines are written by 03b's phase 0; this task fills them) | §3.7 |
| 17 | Paper fallback over `stationPresence()` | `apps/hub/src/print/fallback.ts` | §3.4 |
| 18 | `printDocument` | `apps/hub/src/print/api.ts` | §3.9 |
| 19 | Admin routes test / cancel | `apps/hub/src/print/routes.ts` | §6.4–6.5 |
| 20 | Queries print-config, print-queue, order-tickets | `apps/hub/src/queries/` | §6.6–6.8 |
| 21 | `kds_printed` catch-up + `printed_lines` frame | `apps/hub/src/ws/print-catch-up.ts` | §3.8 |
| 22 | Retention (⚠️ Changed by v1.0.1 (G-8, owner 2026-11-11): called from the sweeper's `purge()`) | `apps/hub/src/print/retention.ts` | §5 |
| 23–25 | Hub admin Printers page: printers + test, outputs, queue + suspects | `apps/client/src/features/admin/printers/` | §8 |
| 26 | `printed` tag through 03b's line-tag slot | `apps/client/src/features/print/` | §8 |
| 27 | Reprint action through 03b's slots (KDS, Pass card) | `apps/client/src/features/print/` | §8 |
| 28 | Manual checks on real printers: LAN + USB, cut, PC437, udev symlink, paper out mid-rush → suspect reprint, pull a KDS cable → fallback, restart mid-print; ⚠️ Changed by v1.0.8 (04 Q-15): **owner (pilot)** — void a cooking karahi with Move to stock and check how the moved line appears on the KDS to the cook (03b drops a voided line, so the ticket line vanishes while the MOVED slip says keep cooking) and that the cook reads the slip right | `docs/plans/03c-manual-checks.md` | §3 |

| 29 | ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): move 05's customer line time into `customerReadyAt` (pure); 05's `ready-times.ts` imports it; 05 tests #92–#97b unchanged. **Lands only after 03c v1.0.16 and 05 v1.0.35 are both approved** (it edits a 05 file) | `apps/hub/src/print/render/ready-at.ts`, `apps/hub/src/billing/print/ready-times.ts` | §3.11, §4.2; 05 v1.0.35 §3.16 |
| 30 | ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): `buildTakeawaySlipDoc`, `dayText`, golden bytes | `apps/hub/src/print/render/takeaway-slip.ts`, `render/jobs.ts` | §3.11 (tests 57, 58) |
| 31 | ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): error code `TAKEAWAY_SLIP_NOT_ALLOWED` (after the F §6.2 append; catalogue test), `printDocument` `meta.order_id`, `slipPrinterRow`, `print-queue` `kind_label`, command `PrintTakeawaySlip` | `packages/domain/src/errors.ts`, `apps/hub/src/print/{api.ts,bill-routes.ts,commands/print-takeaway-slip.ts}`, `apps/hub/src/queries/print-queue.ts` | §3.9, §6.7, §6.14, §9 (tests 59–64, 66) |
| 32 | ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): `queueTakeawaySlipOnSubmit` + `TAKEAWAY_SLIP_REPLAY_MS`; its 02b call site is 02b v1.0.25's task (rows Q-TK-1…Q-TK-3), after 00 HPA v1.13 `statusLink` and 01a TS-3 land (until then `statusLink` is injected and the setting read with `?? true`) | `apps/hub/src/print/slip-hook.ts`, `packages/domain/src/print.ts` | §3.11 (test 65) |
| 33 | ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): manual check (pilot): a slip on the pilot receipt printer at 58 and 80 mm, the token readable across the counter, the QR scans from the guest Wi-Fi | `docs/plans/03c-manual-checks.md` | §3.11 |

≈ 33 tasks (⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): was ≈ 28).

---

## §12. DoD, checklist, questions, closure

### 12.1 Definition of Done

Gate green; every §10 test passes; §12.2 ticked; §4.4 bumps approved and applied; manual checks (task 28) on the pilot printers if the pilot attaches any; README 03c row → Implemented.

### 12.2 Endpoint checklist

| # | Unit | Session · permission | Statements | Test |
|---|---|---|---|---|
| 1 | `ReprintTicket` | station / `reprint-ticket` | 2 | 9 |
| 2 | `SavePrinter` | admin · `manage-devices` | 2 | 50 |
| 3 | `SetStationOutput` | admin · `manage-devices` | 1 | 51 |
| 4 | `POST /admin/print/test` | admin · `manage-devices` | 2 | 27 |
| 5 | `POST /admin/print/jobs/:id/cancel` | admin · `manage-devices` | 1 | 52 |
| 6 | `print-config` | admin | 5 (⚠️ Changed by 05 (row P-1, R-22): was 4; ⚠️ Changed by 05 (row P-1, R-38): `zones` / `floors` add 0) | 50, 55 (⚠️ Changed by v1.0.9, Q-48; ⚠️ Changed by 05 (row P-1, R-38): `zones` / `floors`) |
| 7 | `print-queue` | admin | 2 | 23 |
| 8 | `order-tickets` | `reprint-ticket` | 2 | 9 |
| 9 | `kds_printed` + `printed_lines` | station / point staff | 1 | 40 |
| 10 | Kind `printer_problem` | — | — | 54 |
| 11 | Projections ×2 | — | ≤ 3 reads / event | 2–8 |
| 12 | Worker / fallback | — | ≤ 2 + 1 per dark station | 42 |
| 13 | `SetBillRoute` ⚠️ Changed by 05 (row P-1, R-38 note) | admin · `manage-devices` | 2 | 56 |
| 14 | `PrintTakeawaySlip` ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | staff · `take-order` (no scope) | `reprint` ≤ 4, `pay_later` ≤ 5 | 59–64, 66 |
| 15 | `queueTakeawaySlipOnSubmit` (in 02b `SubmitOrder`) ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | 02b's | ≤ 3 root, ≤ 4 addition | 65 |

### 12.3 Open questions

| # | Question | Owner |
|---|---|---|
| D-1 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) **BLOCKER-for-approval** | **Trigger** (B-2). Written default: the *Send · pay later* slip rides on `SubmitOrder` (`takeaway.print_slip`, queued in its transaction, 02b rows Q-TK-1…Q-TK-3); a queued replay prints within `TAKEAWAY_SLIP_REPLAY_MS` (2 min) of its `queued_at`; `PrintTakeawaySlip` covers a Send & pay panel closed unpaid and reprints. Alternative: the client-sent command only (v1.0.16's first draft). | owner |
| D-2 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) **BLOCKER-for-approval** | **Pickup order's Ready line** (M-4). Written default: the pickup time itself (no padding) while no line lands after it; the latest customer time when the kitchen is late. | owner |
| D-3 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) **BLOCKER-for-approval** | **Who may print / reprint a slip** (M-3). Written default: any `take-order` holder for any token (shared counter, R3), scope not applied, `requires_approval` reads as allowed. Alternative: 05's `covers()` scope rule (a cashier with `own_tables` reprints only tokens they placed). | owner |
| D-4 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) **BLOCKER-for-approval** | **Audit event** (M-2 (d)). Written default: no event; slip jobs carry the root `order_id` for 7 days and show in `print-queue`. Alternative: `TakeawaySlipPrinted { order_id, reason, job_id }` on the order stream for 04's audit. | owner |
| D-5 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) **BLOCKER-for-approval** | **Partly paid bill** (m-2). Written default: still pay-later, the slip prints. Alternative: `skipped: 'part_paid'`. | owner |
| D-6 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) **BLOCKER-for-approval** | **Setting default and the doc-kind deviation** (m-13). Written default: `takeaway_slip_on_send` = true (R6; the hand-off's Q3 asked about paper cost); a `document` job labelled `Token slip`, not the ruling's `takeaway_slip` doc kind (no migration; a dedicated kind would need a `print_jobs` rebuild `NNNN_print_jobs_takeaway_slip.sql`). | owner |
| D-7 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) **BLOCKER-for-approval** | **"Print check bill on the cart"** (M-5, R6). Written default: an unsent cart shows its total on screen (no paper); the paper check bill is `PrintCheckBill` on a sent token's cart and token view. Alternative: a new hub `PrintCartEstimate` for an unsent cart (no bill, no event), not specified. Same row in 05 v1.0.35 §12.3. | owner |
| D-8 ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1) | **Wording and size**: the Roman Urdu lines ("Aap ka token: 57", "Paise counter par dein", "Order dekhne ke liye scan karein"); the token at `Doc` size 2 (a larger ESC/POS size would need a new `Doc` size, not proposed). | owner |
| ~~OQ-C2…OQ-C7~~ | ⚠️ Changed by v1.0.16 (02b-TK R6; hostile run 1): replaced by D-1…D-8 (OQ-C3 closed by m-3: the slip always shows its time). | — |
| OQ-C1 | ~~Pilot printers at go-live~~ **Answered (owner, 2026-11-11): yes, the pilot attaches kitchen printers.** 03c is needed **before go-live** (milestone A, 2027-02-28), not only before 05; manual checks (task 28) run on the pilot's own printers. | closed |

### 12.4 Run 2 closure (printing part of `03b_v0.2_hostile_run2.md`)

| Finding | Resolution |
|---|---|
| M-1 no write timeout; USB blocks the thread pool | Fixed: 10 s write timeout, LAN `setTimeout` / `destroy`, USB in a killable child process (§3.7, D3); tests 21, 22. |
| M-2 ack into a printer in error loses tickets | Fixed: suspect jobs + automatic REPRINT on recovery (§3.5, D4, R-5); unknown-status limit stated; test 25. |
| M-3 `printer_problem` details stripped | Fixed via 03b's D-2; `pick({ printer_name, problem })`; test 54. |
| m-1 unknown status never clean | Fixed: "clean or unknown" (§3.7); test 26. |
| m-2 cancelled kitchen job blocks re-print; silent skipped fold | Fixed: unique index on uncancelled only + `:kitchen:n` ids; `print_fold_skips` + alert (§3.3); tests 6, 8. |
| m-9 admin paths, route group | Fixed: `/admin/commands`, `/admin/print/*` in the admin group, `/admin/queries` (§3.10). |
| m-11 `lib/boot.ts` not listed | Fixed: row H-11, task 16 (approved by R-4). Kind (task 6) before worker (14–15). |
| m-12 no reprint for printer stations | Fixed: Pass card reprint (§3.5, task 27; R-6). |
| m-13 FIFO waits for status | Fixed: advances at ack; status throttled (§3.7). |
| m-14 CANCELLED "every removal" | Fixed: row Q-1 (02b v1.0.3). |
| m-15 slip units source, registration order | Fixed: payload `units ?? null`, units left at send; order asserted (test 10). |
| n-4 pull and FIRST | Fixed: stated in P9. |
| n-7 partial-write slip | Stated (§3.7). |
| n-8 fallback step 4 | Fixed: one query per loop (§3.4). |
| n-12 retention / per-station cost | Fixed: `tickets_fired` index; cost stated (§3.7). |
| Run 1 printing rows left "partly" (M-3 total fold, M-6) | Closed by m-2 and M-1 / M-2 above. |

### 12.5 Targeted check closure (`03b_v0.3_03c_v0.1_targeted_check.md`, verdict FIX) — 03c part

| Finding | Resolution |
|---|---|
| M-3 suspect window misses paper-out between reads | Fixed: `last_clean_at`, every job acked since it turns suspect on a bad read (§3.1, §3.5, D4); test 25. |
| m-5 version collisions | Fixed: Q-1 → 02b v1.0.6 (⚠️ Changed by v1.0.2 (AD-15): was v1.0.4); D-3 and H-11 ride 03b's 01d v1.2.2 / 00 v1.9 bumps (one bump per target, 03b task 0d); 03c tasks 0a, 0b dropped. |
| m-6 Pass reprint for the Cook; printer flag | Fixed: Cook default via 03b B-1; `order-tickets.has_printer` (§6.8); test 9. |
| m-7 timing asserts | Fixed: injected clock and timeouts; test 22 asserts the login resolves, latency is a manual check. |
| m-9 skip at a `screen` station with a printer | Fixed: skips recorded at any station with a printer; alerted when it prints at fire or when the station is dark (§3.3); test 8. |
| m-10 editing 03b's client folders | Fixed: 03b's slots (D12, §8, tasks 26–27 in `features/print/`). |
| n-4 H-11 overstated | Fixed: resume via `registerBootStep('5')`; H-11 = worker after listen only. |
| n-5 idle vs hard timer | Fixed: hard timer from first byte (§3.7); test 21 slow reader. |
| n-6 lost tests / lines | 03c part fixed: render vs removal race (test 9b), `print_config` rebuild keeps runtime (test 29), D8, pending jobs follow the printer (§3.2), To 07 row (§4.3), station session reprint by order (§3.5). |
| n-9 suspect recovery kind / duplicates | Fixed: same kind, one recovery job per ticket (§3.5); test 25. |
| M-1, M-2, m-1–m-4, m-8, m-11, m-12, n-2, n-3, n-7, n-8, n-10 | 03b v0.4 §12.7. |

### 12.6 Re-check closure (`03b_v0.4_03c_v0.2_recheck.md`) — 03c part

| Finding | Resolution |
|---|---|
| M-3 partly (two suspect rules; NULL window) | Fixed as N-1. |
| N-1 Ack line + NULL `last_clean_at` | Fixed: Ack points to §3.5; `COALESCE(last_clean_at, 0)` (§3.5, §3.7); test 25. |
| N-3 screen mode, printer, no KDS | Fixed: `no_screen` warning (§3.2, §6.6). |
| N-8 clean read during buffer drain | Fixed: clean read sets `last_clean_at = now − 10 s`, never backwards (§3.5); test 25. |
| N-2, N-4–N-7 | 03b v0.4.1 §12.8. |

### 12.7 Known gaps and future features ⚠️ Changed by v1.0.8 (04 Q-17)

| # | Feature | Status | Where it goes |
|---|---|---|---|
| F-1 ⚠️ Changed by v1.0.8 (04 Q-17) | Multi-language kitchen slips (owner wish 2026-11-12): slip language as a setting (e.g. English, Roman-Urdu ASCII; Urdu script would need raster printing). Not built; needs its own 03c design. | Owner wish 2026-11-12 20:42 PKT; slips print English until then (Q-17) | A later 03c design + bump; `docs/OPEN-QUESTIONS.md` §7 03c-F1 |
