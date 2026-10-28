# 01c — Menu: variants, modifiers, deals — Module Spec v1.0 (APPROVED)

**v1.0 — APPROVED (2026-10-29), G4 run 5.** Hostile review G4 run 5 on v0.6 (`docs/reviews/01c_hostile_G4.md` "Run 5 — v0.6", commit cde9a2d): **APPROVE**, 0 BLOCKER, 0 MAJOR, 4 MINOR (T1–T4). The approved text is v0.6 unchanged, plus: the build-time fixes T1–T4 and the developer's T4 decision in **§12.7**; that decision noted in V13 and in the §6.5 rule precedence. §4.5 applied on approval: 01a → v2.0 (`01_Restaurant_Setup_Spec_v2.0.md`), 01b → v1.2 (`01b_Staff_Roles_Spec_v1.2.md`), README rows (R28, R29, R30, module map, carried rows), each with "Changed by 01c v1.0" markers (R26).

**Changes in v0.6 (2026-10-29).** Hostile review G4 run 4 on v0.5 (`docs/reviews/01c_hostile_G4.md` "Run 4 — v0.5": 0 BLOCKER, 1 MAJOR, 3 MINOR) applied with the developer's decisions. One line per finding:
- **Q1** New §6.12 merged-row rule **R6**: whenever the merged group is active (a restore, or any PATCH that sends `options`), every active option's linked item is active, `sale_unit = 'piece'` and not `requires_weighing`, read under the linked items' `FOR SHARE` (kind 4, already in the §6.12 lock order) → `422 { field: 'options.N.linked_item_id', reason: 'linked_item_not_piece' \| 'archived' }`; so restoring a group can no longer bring back a link that R10 let go while the group was archived. Builder backstop (defence in depth): §4.6 rule 2 leaves out a linked option whose item is archived, not `piece` or weighed. §3.3 row, §6 lock table row 4, §6.12 edge rows; test 125 extended (archive Bread → Naan `g` → restore Bread → `422`), builder test 127.
- **Q2** One precedence for §6.5 C4 step 6 when several merged rules fail: `400` rules first; then the `409`s in the order R4, R10, R6 (modifier groups before deals, as R4); then the `422`s in rule-number order; R5 (unique index) at the write. Test 125's Naan has no draw and is in no deal part; the combined cases are the new test 128.
- **Q3** `itemsById` added to `checkOptionChoices`, `isGroupSatisfiable` and `isItemOrderable`; one `isAvailable(itemId, quantity)` signature everywhere (§3.4.6, §4.2, §4.4 02); a linked item absent from `itemsById` is not orderable.
- **Q4** (decision) `ItemAdded` gains `option_quantity: number | null` (§4.3): the option quantity per parent unit on an `option_child` placed in its parent's `SubmitOrder`; null on every other kind and on a child added later (§4.4 02 "Later additions"). A partial parent void cascades only into children with `option_quantity` set (k × `option_quantity`, clamped to the remaining units); a child with null is voided only by its own unit voids, when the parent's last unit is voided, or with the parent voided whole (§3.4.8, §4.4 02 and 04); test 126 and test 119's generator add the later-added child.

Counts: endpoints unchanged (14 own, 22 touched). Tests numbered 1–128 with 71 and 72 retired: **126 tests** (was 124).

**G4 run 4 self-check (finding → where fixed):**

| Id | Fixed in |
|---|---|
| Q1 | §3.3 options row, §4.6 builder rule 2, §6 lock table row 4, §6.12 script, R6 and edge rows, §11 steps 10 and 12, §12.2 rows 6.12 and 6.17, §12.6, tests 125, 127 |
| Q2 | §6.5 "Rule precedence" and edge row, §11 step 8, §12.2 row 6.5, tests 125, 128 |
| Q3 | §3.4.6, §4.2 `menu-lines.ts` row, §4.4 02 row |
| Q4 | §3.4.8, §4.3 `ItemAdded` (`option_quantity`), §4.4 02 and 04 rows, tests 119, 126 |

**Changes in v0.5 (2026-10-29).** Hostile review G4 run 3 on v0.4 (`docs/reviews/01c_hostile_G4.md` "Run 3 — v0.4": 0 BLOCKER, 1 MAJOR, 4 MINOR) applied with the developer's decisions. One line per finding:
- **P1** New §6.5 merged-row rule **R10**: a `sale_unit` change away from `piece`, or `requires_weighing` turned on, for an item that an active option of an active group links → `409 CONFIG_IN_USE { entity: 'menu_item', id, used_by: { entity: 'modifier_group', ids } }` (01a S22 pattern, the same read as R4; race covered by §6.5's item `FOR UPDATE` against §6.12's `FOR SHARE` on linked items); §3.3 row, §6.5 edge rows, §9; test 125.
- **P2** (decision) In the `'line'` position `isGroupSatisfiable` counts a linked option toward Σ `max_quantity` only when `isItemOrderable(linked item, …, 'child', 1, isAvailable)`; a required group whose only options are linked items that are all unavailable makes the parent item not orderable (§3.4.6, §4.2, §4.4 02); test 122 extended.
- **P3** §6.9 locks the station `FOR SHARE` before the `stock_item_branches` row is written (the stock item `FOR UPDATE` serialises the row; the version compare reads it without a lock). Every §6 script now states its locks in the table's order (§6.4, §6.8 and §6.15 scripts written out, §6.16 stated on its own); the per-write list is corrected and the bump (`branches`, kind 10) is added to the table.
- **P4** (decision) A partial void of a `piece` parent line voids, per voided parent unit, its share of each `option_child` line (option quantity per parent unit), refunded by the §3.4.8 void-order shares; a g/ml parent line is voided whole only and its children follow; an `item` line's refundable amount and units defined (§3.4.8, §4.4 04); test 126; test 119's generator adds partial parent voids.
- **P5** Header self-check row N3 corrected (§6.11, §6.12, §6.14, not §6.4); §12.6 notes read "AU-1–AU-11 (AU-9 superseded)" and "6.5 R1–R10"; the version row lists every section changed in v0.4 and v0.5.

Counts: endpoints unchanged (14 own, 22 touched). Tests numbered 1–126 with 71 and 72 retired: **124 tests** (was 122).

**G4 run 3 self-check (finding → where fixed):**

| Id | Fixed in |
|---|---|
| P1 | §3.3 row, §6.5 R10 and edge rows, §9 `CONFIG_IN_USE` note, §12.2 row 6.5, test 125 |
| P2 | §3.4.6, §4.2 `isGroupSatisfiable` row, §4.4 02 row, test 122 |
| P3 | §6 "Lock order" table (row 10) and per-write list, §6.4, §6.8, §6.9, §6.15, §6.16 scripts |
| P4 | §3.4.8, §4.4 04 row, §10.9 G4 row, tests 119, 126 |
| P5 | header self-check (v0.4 table, row N3), §1 version row, §12.6 |

**Changes in v0.4 (2026-10-29).** Hostile review G4 run 2 on v0.3 (`docs/reviews/01c_hostile_G4.md` "Run 2 — v0.3": 0 BLOCKER, 1 MAJOR, 8 MINOR) applied with the developer's decisions. One line per finding:
- **N1** (decision) Refunds on a line never exceed what was billed: a later void refunds the **remaining** refundable amount; the k-th unit voided gets share k of `allocateDealMinor(refundable, [1, …, 1])`, the last remaining unit the remainder; a `deal_part` unit is one deal portion (piece part: one piece; g/ml part: one deal's whole part quantity, never per gram); voiding the deal refunds its line total minus every refund already made on its parts; 04 persists per-line refunded amounts and voided units (§3.4.8, §4.4 04); tests 117, 118, 119.
- **N2** (decision, replaces AU-9) §6.5 locks the item only after its group locks; the locked re-read is compared with the group it locked (null included); on a difference the transaction rolls back and restarts, at most 3 attempts, then `503 SERVICE_UNAVAILABLE`; applies on the no-group path too (§6 lock order, §6.5); test 120.
- **N3** One global lock order for every 01c write, as a table (§6 "Lock order"), `variant_group` before `menu_item`; §6.2 locks members before the category; §6.11 / §6.12 lock variant groups before items; every write checked against it; test 121.
- **N4** Test 104 replaced by a case that tells BigInt from floating point.
- **N5** A linked option is selectable only when `isItemOrderable(its item, …, 'child', child quantity, isAvailable)` (§3.4.6, §4.2, §4.4 02); test 122.
- **N6** V9 and §3.4.6 use one identical sentence for groups in a child position, a group mixing plain and linked options included; `isGroupSatisfiable(g, 'child')` defined; test 96 extended.
- **N7** 01a test 128 gets build step 8; test 116 listed under §6.11 in §12.2.
- **N8** Restoring an item re-checks that its stock draw's stock item is active (§6.5 R9, §3.3); test 123.
- **N9** §8 create-stock-item flow keeps the POST's `Idempotency-Key` for retries and re-reads §6.6 (stock items and branch versions) before retrying; the m11 warnings show only after the last menu page has loaded; test 124.

Counts: endpoints unchanged (14 own, 22 touched). Tests numbered 1–124 with 71 and 72 retired: **122 tests** (was 114).

**G4 run 2 self-check (finding → where fixed):**

| Id | Fixed in |
|---|---|
| N1 | §3.4.8, §4.2 `allocateDealMinor` row, §4.4 04 row, tests 117–119 |
| N2 | §6 "Lock order" (restart rule), §6.5 script and edge row, §12.3 AU-9 (superseded), test 120 |
| N3 | §6 "Lock order" table, §6.2, §6.5, §6.11, §6.12, §6.14 scripts, test 121 (row corrected in v0.5, P5: §6.4's text was not changed in v0.4) |
| N4 | test 104 |
| N5 | §3.4.6, §4.2 `checkOptionChoices`, §4.4 02 row, test 122 |
| N6 | V9, §3.4.6 (identical sentence), §4.2 `isGroupSatisfiable`, test 96 |
| N7 | §11 step 8, §12.2 row 6.11 |
| N8 | §3.3 row, §6.5 R9 and edge row, test 123 |
| N9 | §8 views and "Omitted at a branch", tests 115, 124 |

**Changes in v0.3 (2026-10-29).** Hostile review G4 on v0.2 (`docs/reviews/01c_hostile_G4.md`: 2 BLOCKER, 9 MAJOR, 16 MINOR) applied with the developer's decisions. One line per finding:
- **B1** `ItemAdded` copies `program_cook_time_ms` / `stock_program_cook_time_ms` from `programs[]` (D25); A6 keeps the 01a batch cook-time copy; test 93.
- **B2** Deal-part charges scale with deal quantity (piece: extra × part qty × deal qty; g/ml: extra × deal qty; plain options on a g/ml part: parent qty = deal qty); V11 a, §3.4.3, §3.4.4; tests 94, 95.
- **M1** Child position: all-linked groups are not offered and do not count; plain groups apply; plain configured but none offered → item not orderable there; snapshot `has_plain_options`; V9, §3.4.6, §4.2, §4.6; test 96.
- **M2** A linked option is selectable only when its item is available (`isAvailable` input to `checkOptionChoices`); §3.4.6, §4.4 02; test 97.
- **M3** Lock order variant group before item (§6 lock-order paragraph, §6.2, §6.5); race test 98.
- **M4** §6.9 and §6.16 lock the parent `FOR UPDATE`; race test 99.
- **M5** 20-group limit is a write-time soft limit; no cap in the schema or builder (V8, §4.6 rule 3); test 100.
- **M6** Restore re-runs R1 and "group is active"; §6.2 moves archived members too (§3.2.4, §6.2, §6.5 R1, R1a); test 101.
- **M7** The weight event carries `{ order_item_id, quantity, line_total_minor }` from the `ItemAdded` copy (§4.3, §4.4 02/04/05/07).
- **M8** Per-unit voids of `deal_part` / `option_child` lines and parent→child cascade, carried to 04 (§3.4.8, §4.4 04); test 102.
- **M9** (+ m2, reverses F2) Allocation weight = the part's reference choice (first by choice `sort_order`), not the chosen item (V11 c, §4.3); test 8 refixtured, test 103.
- **m1** `allocateDealMinor` uses BigInt and throws on a non-safe result (§4.2); test 104.
- **m2** Closed by M9 (allocation no longer depends on the chosen item).
- **m3** Deal parts upserted like options; only choices rewritten, FK order (V14, §6.15); test 105.
- **m4** §6.12a deletes only rows of active options; test 106.
- **m5** `modifier_groups[]` only referenced groups; `deal_part_choices.sort_order` (table, wire, version input, snapshot); test 107.
- **m6** §4.5 01a test list adds 4, 140, 143, 145, each checked; hedge removed.
- **m7** A2 names the tracked rule as a change; §8 item form "Create a stock item with this name" (no new endpoint).
- **m8** `stock_items.kind` dropped (V3, §3.3, §4.6, §5.1, §5.4, §6.7); R28 adds it.
- **m9** Deal On/Off toggle deferred (§12.4): `SetDealAvailability`, `DealMade*`, hub migration, `deal_availability`, deal catch-up and query parts, Deals tab and V17 removed; tests 71, 72 retired.
- **m10** Tests 111 (§6.5 R1 on PATCH), 112 (§6.12 C9 edge row), 113 (effective-set order), 114 (hub upgraded with a v1 day open).
- **m11** Owner pages warn when a deal or linked option is omitted at a branch (§8); test 115.
- **m12** `ItemAdded.category_id` (the deal's on `deal` / `deal_part`); 07 counts part option charges under the part's item (§4.3, §4.4 07).
- **m13** Option-name uniqueness in one SQL statement over `lower(name)` under the group lock (V14, §3.3, §5.1, §6.12 R4); test 116.
- **m14** `dayDraws` falls back to config; a draw whose stock item's frozen unit differs is not used that day (V20); test 108.
- **m15** Group PATCH re-checks only added or changed links; the builder ignores archived targets; V16 / §6.5 R4 count only options of active groups; test 109.
- **m16** `isDealOrderable` passes the part line quantity for `sold_out` choices (V11 d, §4.2); test 110.

Counts: endpoints 14 own (was 15), 22 touched (was 23). Tests numbered 1–116 with 71 and 72 retired (not reused): **114 tests** (was 92).

**G4 self-check (finding → where fixed):**

| Id | Fixed in |
|---|---|
| B1 | §4.3 fields, §4.4 02/03a rows, §4.5 A6, test 93 |
| B2 | V11 a, §3.4.3, §3.4.4, §4.3 `extra_price_minor`, tests 94, 95 |
| M1 | V9, §3.4.6, §4.2 (`isGroupSatisfiable`, `isItemOrderable`, `isDealOrderable`), §4.4 02, §4.6 rule 3 `has_plain_options`, test 96 |
| M2 | §3.4.6, §4.2 `checkOptionChoices`, §4.4 02, test 97 |
| M3 | §6 lock order, §6.2 script, §6.5 script, test 98 |
| M4 | §6 lock order, §6.9 script and edges, §6.16, test 99 |
| M5 | V8, §3.3, §4.6 rule 3, test 100 |
| M6 | §3.2.4, §6.2 script, §6.5 R1 / R1a and edge row, test 101 |
| M7 | §4.3 "Weight entered later", §4.4 02, 04, 05, 07 rows |
| M8 | §3.4.8, §4.2 `allocateDealMinor`, §4.4 04 row, test 102 |
| M9 | V11 c, §4.3 field comment and example note, tests 8, 103 |
| m1 | §4.2 `allocateDealMinor`, V11 c, test 104 |
| m2 | V11 c (by M9) |
| m3 | V14, §6.15 notes, test 105 |
| m4 | §6.12a script, test 106 |
| m5 | V10, §3.3, §4.6 example and rules 3, 5, §5.1, §5.4, §6.14, test 107 |
| m6 | §4.5 cost table (01a tests) |
| m7 | §4.5 A2, V12, §8 views |
| m8 | V3, §3.3, §4.6 example, §5.1, §5.4, §6.7 |
| m9 | §1 in scope, V11 d, V17, §3.5.4, §4.2, §4.5 A5/A7/A8/B1/cost, §5.2, §6.0, §6.21, §6.22, §6.23, §8, §9, §10 (70–72), §11, §12.2, §12.4 |
| m10 | §6.12 edge row, tests 111–114 |
| m11 | §8 "Omitted at a branch", test 115 |
| m12 | §4.3 `category_id`, §4.4 07 row |
| m13 | V14, §3.3, §5.1 comment, §6.12 R4, test 116 |
| m14 | V20, §4.2 `dayDraws`, test 108 |
| m15 | V8, V16, §4.6 rule 6, §6.5 R4, §6.12 script, test 109 |
| m16 | V11 d, §4.2 `isDealOrderable`, test 110 |

**Changes in v0.2 (2026-10-28).** From gate G2 on v0.1 (`docs/reviews/01c_gate_G2.md`, fix list 1–15), the developer's answers to v0.1 §12.3 (D-1 to D-5), review findings F1–F4, and the owner/developer answers G3 1–11 (§12.5).
- **G2 fixes:** §1 next step and generic-model note; C4 order in §6.9 / §6.16 (archived check after the version); §6.2 response; hub rows in §6.0; §4.3 example marked abridged; §4.6 sort rule; §9 `CONFIG_IN_USE.used_by.entity`; §4.5 cost list corrected (no `upcasters/` folder: `upcastFromPrevious` on each v2 event; `admin/hub.ts`, `lib/config-audit.ts`, engine log fixture, client tests, `isStockTracked` callers added); tests 77–80 and stronger tests 21, 36; §12.2 mapping.
- **D-1** confirmed (V11 c). **D-2** carried to 02 (§4.4). **D-3** item `sale_unit` change that breaks a deal part → `409 CONFIG_IN_USE` (§6.5 R6, test 83); the builder-drop default is removed. **D-4** contract migration in the first release after 02 ships (§12.4). **D-5** per-item draws stay in `BusinessDayOpened` v2 (V20).
- **F1** the builder keeps a required group with `options: []` (§4.6, test 81). **F2** `deal_part.price_minor` = the chosen item's effective branch price (§4.3). **F3** next step G4. **F4** stock query `has_tracked_drawers` (§6.21, test 82).
- **G3 answers:** `[ASSUMPTION-N]` tags removed; §12.5 is now the G3 answers table. New: **weighed items** `requires_weighing` (V18, tests 84–87) and **per-branch options** `modifier_option_branches` with `PUT /v1/admin/modifier-groups/:id/branches/:branch_id` (V19, §6.12a, tests 88–92).
- Endpoints: 15 own (was 14), 23 with the changed 01a routes. Tests: 92 (was 76).

## §1. Header

| Field | Value |
|---|---|
| Module | 01c Menu: variant groups (sizes, half/full, quarter), stock items shared by several sellables (the "pot"), modifier groups with plain and linked options, deals/combos whose parts go to their own stations; the order-line contract 02 copies (D25) |
| Version | **v1.0 — APPROVED (2026-10-29), G4 run 5** (`docs/reviews/01c_hostile_G4.md` "Run 5 — v0.6": 0 BLOCKER, 0 MAJOR, 4 MINOR; build-time fixes §12.7). v0.6 — DRAFT (2026-10-29). Gate G2 run 2 in `docs/reviews/01c_gate_G2.md`; hostile review G4 runs 1 (on v0.2), 2 (on v0.3), 3 (on v0.4) and 4 (on v0.5) in `docs/reviews/01c_hostile_G4.md`, applied in v0.3, v0.4, v0.5 and here. Sections changed in v0.4: V9, §3.3, §3.4.6, §3.4.8, §4.2, §4.4 02 and 04, §6 lock order, §6.2, §6.5, §6.11, §6.12, §6.14, §8, §10.9, §11, §12.2, §12.3, §12.6, tests 96, 104, 115, 117–124. Sections changed in v0.5: §3.3, §3.4.6, §3.4.8, §4.2, §4.4 02 and 04, §6 lock order, §6.4, §6.5, §6.8, §6.9, §6.15, §6.16, §9, §10.8d, §10.9, §11, §12.1, §12.2, §12.6, tests 119, 122, 125, 126. Sections changed in v0.6: §3.3, §3.4.6, §3.4.8, §4.2, §4.3, §4.4 02 and 04, §4.6, §6 lock order, §6.5, §6.12, §10.6, §10.8c, §10.8d, §10.8e, §11, §12.1, §12.2, §12.6, tests 119, 125–128. **Next step: implementation plan** `docs/plans/01c-plan.md` (pipeline step 5), carrying §12.7 T1, T3 and T4 into its tasks |
| Generic model | Variants, options and deals are fully generic: any number of variants per group with any names the owner chooses (Half/Full/Quarter, Medium/Large/Jumbo), any extras, any deal shape. No rule anywhere names a dish. Karahi, naan, lassi and the Karahi pot in this spec are **seed and test examples only** (G3 1). Raw-ingredient use per variant (bun 1, cheese 40 g on Large) is the recipe inventory module's (proposed R28); 01c guarantees one `item_id` per variant |
| Depends on | Foundation v1.7 (APPROVED — FINAL); 00 Hub Platform & Access v1.5 (APPROVED, implemented); 01a Restaurant Setup v1.3.1 (APPROVED, implemented); 01b Staff and Roles v1.1 (APPROVED, implemented) |
| Inherits | **Shared Standards from Foundation v1.7 §6**, unchanged. Overrides of a foundation section are named in §3.1 (V-rows) with the section they override (D64). Carried conventions C1–C9 (README) apply; 01c extends 01a, so 01a's behaviour is its default where 01a and 01b differ (R27 c) |
| Changes other specs | **Breaking, by the developer policy of 2026-10-28 (V1):** 01a → v2.0 (snapshot schema 2, stock keyed by stock item, item fields moved); 01b → v1.2 (B20 scope by the stock item's station); README (proposed R28, module map row 01c, carried rows). Full list with cost: §4.5 |
| Tier | T2 Production (foundation §1) |
| Milestone | A (pilot). Build order (01b header, R27 e): 01b → **01c** → 01d → 03a → 02 → 04 |
| Inputs | README 01c row, R18, R26, R27, C1–C9, carried rows "To 01c" and 02 "Mid-service safety"; 01a §3.1 S12, S14, S28, S41, S44, S47, S57, S59, §3.3, §4.3, §4.4, §6.11–§6.16, §12.5; 01b B20, B23, §5.3; stories E0-MENU AC4–6 and edge cases, E1-ROUTE AC1, AC3 and edge cases; `docs/design/inventory/01c-menu-variants.md`; code `apps/cloud/src/modules/restaurant/`, `packages/events/src/config.ts`, `packages/events/src/admin/restaurant.ts`, `packages/engine/src/{state,stock}.ts`, hub stock commands; developer decisions Q1–Q7 of 2026-10-28 (brainstorming) |

### Stories covered

| Story | AC | How |
|---|---|---|
| E0-MENU (categories, items, variants, add-ons, combos) | AC4 variants override price, cook time or station | A variant is a full sellable item in a variant group (V2): every field is its own |
| | AC5 add-ons add price and may change station | Modifier options: plain (price only) or linked to an item, which becomes a child line with its own route (V6) |
| | AC6 combos: one price, one line at ordering | Deals (V9): one billed line, parts as station lines |
| | Edge: variant overrides station to an unconfigured one | A variant's route is an 01a route (§6.16 rules) |
| | Edge: combo contains an unavailable item | `isDealOrderable` (V11) |
| | Edge: zero-price add-on is valid | `price_minor` 0 allowed (§3.3) |
| E1-ROUTE (recipe route) | AC1 serve mode overridable per modifier | **Narrowed (V7):** a plain option never changes serve mode; a linked option's child line keeps its own item's `serve_mode` |
| | AC3 modifiers override price, cook time, station | Variants (own item) and linked options (child line with its own route) |
| | Edge: modifier to unconfigured station | A linked option is offered at a branch only where its item is routed (V8) |
| Carried (01a §4.4 01c row) | Stock pools; `group_label`; `lineTotalMinor` | Stock items (V3–V5); `group_label` replaced by variant groups (V2); line totals §3.6 |

### In scope
- Cloud: variant groups; stock items and their per-branch rows; stock draws on items; modifier groups (options, links, per-branch option offers and prices); deals (parts, choices, per-branch rows, windows); the item flag `requires_weighing` (V18). Versioned writes (V13). Owner app views for each.
- Snapshot schema 2 (V12) and its builder; hub stock commands, query and catch-up keyed by stock item; `BusinessDayOpened` v2, `StockSet` v2, `StockAdded` v2 with upcasters. (A deal On/Off toggle on the hub is deferred, §12.4, v0.3 m9.)
- Pure functions in `@pos/domain` that 02, 03a and 05 call: option checks, child quantity, option charge, deal allocation (also the per-unit void split 04 uses), line totals, item and deal orderability per position (§4.2).
- The order-line contract (`ItemAdded` v1 shape) that 02 implements (§4.3).

### Out of scope
- Ordering screens, `SubmitOrder`, `ItemAdded`/`OrderPlaced` schema files and reservation → **02** and **03a** (they implement §4.3).
- Kitchen tickets for parts and children → **03b** (§4.4 row). Voids → **04**. Tax at bill close → **05**.
- Ingredients, recipes, receiving, wastage, variance, low-stock alerts beyond 01a's level → **recipe-based inventory module** (proposed R28; §4.4 row).
- Images for variants and deals (E0-MENU AC2 image is not built in 01a either; §12.4).
- Per-attachment group rules, splitting a pick-one part across choices, nested variant groups (§12.4).
- Entering a pending weight on an order line (`SetLineWeight`-style command) → **02**; refusing bill close while a weight is pending → **05** (§4.4).
- Deal suggestion during ordering (prompt the cashier to convert matching lines to a deal) → a later module (proposed README carried row, §4.5).

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Cloud config is relational and canonical; owner routes under `/v1/admin`, JWT + tenant guard (D54); every creating `POST` through `withIdempotency`; one transaction per write ending with `bumpConfigVersion`; `writeConfigAudit` insert-only | F §3.3, §6.4; 01a S7, S8, S26 |
| Tenant-level writes need an owner who covers every branch (`403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`); branch-level writes need the branch in `allowed_branch_ids` | 01a S8, §3.3 |
| Common write script and lock order (target row, reference rows `FOR SHARE` in id order, branch rows last in `branch_id` order) | 01a §6 |
| Snapshot delivery: hash over raw JSON, then parse; a schema change is a release of the cloud and every hub together; a stored body of another schema version is treated as missing | 01a S27, S28 b, d |
| Item, route, per-branch price (`price_minor_override`), windows, `serve_mode`, `cook_time_ms`, `stock_time_ms`, `out_of_stock_behaviour`, `sale_unit`, `lineTotalMinor` | 01a S44, S47, S57, S59 |
| Stock shape `{ on_hand, reserved, set_at, unit }`, available = max(0, on_hand − reserved), count valid for one business day unless it carries over, units frozen for the open day, `canServeFromStock` | 01a S14, S41, S44 (re-keyed by V4, not re-ruled) |
| Hub availability is hub-owned and toggled per item (`ItemMadeAvailable` / `ItemMadeUnavailable`, projection `item_availability`); a manual Off wins over windows | D26; 01a S17, S30, S47 |
| Hub command processing order; one command = one transaction; COMMIT-then-swap | F §6.3, D45 |
| `manage-stock` and its scopes `branch` / `my_stations`; `stationsOf(staff, 'count_stock')` | 01b B2, B20 |
| `CONFIG_STALE` and the versioned-write rule (one builder module, version input, canonicalisation) | 01b B23, §5.3 |
| Event store never migrated; payload changes through `schema_version` + upcasters; fixtures never edited | F §4.1, §6.7, §6.8, D46 |

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Reason | Overrides / changes |
|---|---|---|---|
| V1 | **Breaking changes allowed before the pilot (developer policy, 2026-10-28).** No hub runs real orders (pilot 2027-02-28). 01c takes the correct long-term model over backward-compatible workarounds for structure that is expensive to change later (tables, event payloads, snapshot schema, stock key). Each breaking change is named here, listed in §4.5 with its cost, and released to the cloud and every hub together (01a S28 b). Features stay YAGNI | Changing the stock key or the order line after 02 and 03a ship would mean re-versioning every stock and order event with live data | 01a S28 c ("only optional fields within a version") is not used: V12 is a new version |
| V2 | **A variant is a full sellable item in a variant group.** New tenant table `variant_groups { name, category_id, description, sort_order }`; `menu_items` gains `variant_group_id` (null = a plain item) and `variant_name` ("Half", "Full"). One level: a group holds items, never groups. The group is the ordering tile and is never sold itself; only its member items are orderable, chosen as a required one-of. Members have the group's category (§3.3). Every variant keeps its own `item_id`, price, cook time, route, per-branch price, windows, stock draw and toggle, so 02, 03a, the engine and D26 stay keyed by `item_id`. **`group_label` is replaced:** snapshot 2 has no `group_label`; the column is deprecated, no longer written or read (contract later, §12.4) | A flagged parent item would need a fake price and station (snapshot items need `station_id`) and a "never sell this" rule in 02; a child-row model with partial overrides would make every consumer resolve inheritance | 01a S12 (`group_label`), §4.3 |
| V3 | **Stock items are separate from the menu.** New tenant table `stock_items { name, stock_unit, carries_over }` (v0.3, m8: no `kind` column; the inventory module adds `kind` with `'prepared'` / `'ingredient'`, R28). Per branch, `stock_item_branches { station_id, low_stock_threshold }`: a row means "counted at this branch, at this station". **The station is set, not derived** (developer call): deriving it from routes breaks when Half and Full are at different stations, or a naan draws from a pot counted at the Tandoor; 01b's `my_stations` reads this row | One pot sold as Half and Full needs one count; one stock item may feed items in different groups | 01a S14, S41, S44, S46 (§4.5) |
| V4 | **Stock draws.** `stock_draws { item_id, stock_item_id, quantity_per_sale_unit }`: how many stock units one sale unit of the item uses (Half Karahi → Karahi pot 500 g; Full → 1 000 g). Primary key `(tenant_id, item_id, stock_item_id)`, so recipes add rows without a reshape; **pilot: at most one draw per item** (schema `max(1)`). The drawer is always a menu item: a linked option and a deal part draw through the item they point at (developer call: one kind of drawer, no second draw table to keep in step). Unit rule (01a S44, now between the item and the stock item): `sale_unit = stock_unit` → `quantity_per_sale_unit = 1`; they differ → `sale_unit = 'piece'`, quantity 1 … 1 000 000. Replaces `menu_items.stock_unit`, `stock_per_sale_unit`, `low_stock_threshold`, `carries_over` (deprecated columns) | One drawer kind keeps every stock path one lookup | 01a S44 |
| V5 | **The engine and the stock events are keyed by `stock_item_id`.** `EngineState.stock: Record<StockItemId, StockEntry>`; `StockSet` v2 / `StockAdded` v2 carry `stock_item_id`; `BusinessDayOpened` v2 freezes `stock_units` per stock item and `draws` per item; 03a's `StockReserved` / `StockReleased` start at v1 keyed by `stock_item_id` (§4.3). **Migration keeps ids:** each 01a stock-tracked item becomes a stock item with **the same ULID** (§5.1), so the v1 → v2 upcasters rename a field and never need config (§5.3) | Re-keying later would need a config-aware upcaster over live events | **F §4.7** `EngineState.stock` key (already reshaped by 01a S14) and **F §5.9 step 5** `StockReserved { item_id, … }` → `{ stock_item_id, order_item_id, quantity }` |
| V6 | **Modifier groups.** A group `{ name, min_choices, max_choices, sort_order }` holds 1–50 options. An option `{ name, price_minor, max_quantity, is_default, linked_item_id, sort_order }` is **plain** (`linked_item_id` null: a note with a price, e.g. Spicy, No onion, Extra raita) or **linked** (points at a sellable item: it becomes a **child line** of the order line with that item's own route, cook time, serve mode and stock; its price is the option's `price_minor` or, when null, the item's effective branch price). Group rules live on the group only (no per-attachment overrides; a different rule is a different group). `required` = `min_choices ≥ 1` | A linked option needs its own station line; a deal part is a share of one price, which fits combos, not extras (Q3) | — |
| V7 | **Plain options never change station, cook time or serve mode.** A child line keeps its own item's `serve_mode`, the same rule as deal parts | Keeps the timing engine's input per line, not per option | **E1-ROUTE AC1** "overridden per modifier" narrowed: the override is a linked item whose own `serve_mode` differs |
| V8 | **Attachment with opt-out.** `modifier_group_links { modifier_group_id, target_kind ∈ category, variant_group, item, target_id, mode ∈ attach, detach }`, one row per group and target. For a sellable item the **most specific link wins**, item > variant group > category: a group applies when its most specific link to the item is `attach`. So effective set = attachments minus detachments, a lower-level attach re-adds, duplicates drop out, ordered by group `sort_order`, then id. `detach` on a category is meaningless and refused (`400`). Deals take no links: a deal part's item keeps its own groups. **The cloud builder resolves the set** into `items[].modifier_group_ids` (V12); the hub and 02 never recompute inheritance. At most **20** effective groups per item (§3.3), a **write-time soft limit** (v0.3, M5): checked on writes only, never by `BranchConfigSnapshotSchemaV2` or the builder, so two concurrent writes that end at 21 still give a valid snapshot. The builder ignores a link whose target is archived (m15) | The owner attaches "Spice level" to the Karahi category once and opts the karahi raita out | — |
| V9 | **Depth ≤ 1 by position ("ignored in that position").** A sellable in a child position (a linked option's item, or a deal part's item) offers only its **plain** options: its linked options are ignored there; 02's `SubmitOrder` refuses a child that carries a linked option. **Groups in a child position (v0.3 M1; wording v0.4 N6, identical in §3.4.6):** a group with no active plain option configured (`has_plain_options: false`) is not offered in a child position and does not count; any other group is offered there with only its plain options offered at this branch, its linked options never count (offered or not, a group mixing plain and linked options included), and it is satisfiable there only when `min_choices ≤ Σ max_quantity` of those offered plain options; an unsatisfiable group makes the item not orderable in that position. The snapshot's `modifier_groups[].has_plain_options` carries the configured fact (§4.6). No chain can form, A → B → A included, because B's link back is never offered. Chosen over "refused on save" (developer call): refusing would need cross-entity re-checks on five write paths (group links, option links, item category, item variant group, deal parts) | Simple rule, no save-time graph walk | — |
| V10 | **Deals.** `deals { name, category_id, tax_class_id, description, sort_order, price_minor }` with windows (01a S47 rules) and per-branch rows `deal_branches { price_minor_override }` (sold at a branch only with a row). A deal has 1–10 **parts** `{ quantity, sort_order }`; each part has 1–20 **choices** `{ item_id, extra_price_minor, sort_order }` (`sort_order` v0.3, m5): one choice = a fixed part (extra must be 0); several = "customer picks one" (Roghni naan +Rs 30). Pilot: **one choice × the part quantity** (2 × Roghni). A part's quantity is in its items' `sale_unit` (500 g karahi); all choices of a part share one `sale_unit`. A part item keeps its own plain modifier groups (spice level applies inside a deal; paid options add on top). A deal has no route, cook time or stock of its own | Combos are sold today at one price; each part must reach its own station (E0-MENU AC6, 01a §12.5) | — |
| V11 | **Deal pricing, tax and availability.** (a) **Billed:** the deal line carries the deal price × deal quantity, plus each part's extra charge (v0.3, B2: piece part `extra × part qty × deal qty`; g/ml part `extra × deal qty`) and each part's plain option charges (§3.4.3). (b) **Tax:** the deal's own `tax_class_id` applies to everything billed on the deal line; `allocated_price_minor` is for reports, refunds and inventory only, **never for tax**. An option child is taxed with its own item's tax class on its own price. (c) **Allocation** at order time (v0.2: D-1 confirmed by the developer): the deal price × quantity is allocated to the part lines pro rata by each part's weight = `lineTotalMinor(reference choice's effective branch price, part quantity × deal quantity, sale_unit)` (v0.3, M9, reverses F2: the **reference choice** is the part's first choice in this branch's snapshot, by choice `sort_order`, then `item_id`; the allocation never depends on which choice was picked), integer arithmetic (BigInt inside, m1), floor for every part but the last, the remainder to the last part so the parts sum exactly to the deal amount. **A zero-price part gets 0; the split is equal only when every weight is 0** (remainder to the last). The chosen part's extra charge (a, B2) is added to that part only, on top. 05, 07 and inventory read `allocated_price_minor`, never recompute it. (d) **Availability:** a deal is orderable at a branch when it is inside its own windows and its category's, and every part has at least one choice orderable in the deal-part position: item on, inside its windows, not sold out under its `out_of_stock_behaviour` for the line quantity part qty × deal qty (v0.3, m16), and every effective group satisfiable in that position (M1). No deal On/Off toggle (v0.3, m9, §12.4). (e) **Static omission:** the builder leaves a deal out of a branch's snapshot when it has no `deal_branches` row there or a part has no choice routed there; it leaves out choices not routed there | One billed line (AC6); per-part money for 05/07/inventory without a second rounding rule | — |
| V12 | **Snapshot schema 2** (`SNAPSHOT_SCHEMA_VERSION = 2`, `BranchConfigSnapshotSchemaV2`), §4.6. Adds `variant_groups[]`, `stock_items[]` (counted at this branch), `modifier_groups[]`, `deals[]`; items gain `variant_group_id`, `variant_name`, `stock_draws[]`, `modifier_group_ids[]`, `requires_weighing` (v0.2, V18); items lose `group_label`, `stock_unit`, `stock_per_sale_unit`, `low_stock_threshold`, `carries_over`. **Stock-tracked** at a branch (01a §4.3 rule **changed**, v0.3 m7: a stock time or stock program alone no longer tracks an item; it also needs a draw): the item's draw goes to a stock item counted at this branch **and** (slot station: `stock_time_ms` not null; batch station: `stock_program_id` not null). The builder lists only tracked draws, so `isStockTracked(item) = item.stock_draws.length > 0` | One coordinated release now is cheaper than optional-field workarounds that every consumer must special-case | 01a S28 (new version), §4.3 |
| V13 | **Optimistic concurrency on new tables; 01a's tables keep last write wins.** PATCH on `variant_groups`, `stock_items`, `modifier_groups`, `deals`, and the branch PUTs on `stock_item_branches`, `deal_branches`, require `expected_version` (01b B23 style; stale → `409 CONFIG_STALE { entity, id }`; a PATCH whose only key is `expected_version` → `400`, C9). Version inputs §5.4; one builder module `apps/cloud/src/modules/menu-variants/versions.ts`. **Named C4 divergence inherited from 01a:** `menu_items`, `item_routes`, `categories` keep S23 (last write wins), including an item's `stock_draws` (written as one whole field on the item PATCH, ≤ 1 row; the inventory module versions it when draws become multi-row, §4.4). **Also part of this divergence (v1.0, developer decision on G4 run 5 T4, §12.7):** §6.5 keeps 01a's built check order for `menu_items`: the no-op step runs before the reference checks, so re-sending an unchanged archived category → `200` (no-op) | A whole-list replace archives omitted options and parts, so a stale tab must never silently archive one added elsewhere; a stale `stock_unit` edit would corrupt a whole day's count | **01a S23** for the new tables only |
| V14 | **Nested lists are edited inside their parent, whole.** `options[]` (+ `links[]`) on a modifier group, `parts[]` (with `choices[]`) and `availability_windows[]` on a deal are sent whole on POST and PATCH. An entry with an id updates that row; an entry without an id gets a new ULID; a stored active row left out is **archived, never deleted**; sending an archived row's own id restores it (same ULID). An id that is unknown, belongs to another parent, or is another tenant's → `422 CONFIG_REFERENCE_INVALID { field, reason: 'not_found' }` (C1); never created. Write (v0.2): **options** are written with one multi-row `INSERT … ON CONFLICT (tenant_id, option_id) DO UPDATE` for the sent rows plus one `UPDATE … SET archived_at` for the omitted active rows, so `modifier_option_branches` rows that reference an option survive every edit; option-name uniqueness among the group's active options is checked **in the service** by one SQL statement over `lower(name)` (v0.3, m13) under the group row lock (every option write locks the group `FOR UPDATE`), not by a partial unique index, so a rename swap inside one list never fails mid-statement (author's call). **Parts** (v0.3, m3) are written like options: one multi-row upsert of the sent parts plus one `UPDATE … SET archived_at` for omitted active parts, so an archived part keeps its row and ULID. **Choices** of the sent parts and **links** are rewritten with one `DELETE` + one multi-row `INSERT` (as 01a windows); choices are deleted before and inserted after their parts are written (FK order) | Stable ids for every option and part, so order events and the inventory module can always resolve them | — |
| V15 | **Audit of children (C5 application).** Options, links, parts, choices and windows are children of their parent, like 01a's windows: one `config_audit` row on the parent with the whole active list in `before` / `after`, not one row per child. Real cascades to other entities still write one row each (C5): a variant group's category move writes one `menu_item` / `update` row per member | Children have no life outside the parent form | C5 (application named) |
| V16 | **In-use checks on archive (changes 01a).** Archiving an item that an active option of an **active** group links to (v0.3, m15) or an active deal part offers → `409 CONFIG_IN_USE` (01a §6.15 had no in-use check); a category used by an active variant group or deal, a tax class used by an active deal, a station used by an active `stock_item_branches` row → `409 CONFIG_IN_USE` (01a §6.9, §6.12, §6.13 gain these). A stock item with an active drawer, a variant group with active members → `409 CONFIG_IN_USE` | A deal that silently disappears from the snapshot because its naan was archived is worse than a clear refusal | 01a §6.9, §6.12, §6.13, §6.15 |
| V17 | **Removed in v0.3 (m9).** The hub deal On/Off toggle (`SetDealAvailability`, `DealMade*` events, `deal_availability` projection) is deferred to §12.4; a deal is withdrawn at a branch through §6.16, and a part's unavailable item is covered by `isDealOrderable` (V11 d). The number is not reused | No story AC or G3 answer asks for it | — |
| V18 | **Weighed items (v0.2, G3 E1).** `menu_items.requires_weighing BOOLEAN NOT NULL DEFAULT false`, allowed only when `sale_unit ∈ ('g', 'ml')` (else `400`). The price is per kg / L and the actual weight is entered when it is known: at ordering (a fish weighed at the counter) or later (a desi murga weighed after slaughter); **one mechanism for both**. A line may be placed with its weight pending (`quantity: null`); its `line_total_minor` is null until the weight is entered, then `lineTotalMinor(price, weight, sale_unit)` + option charges (S59 rounding and 50 g steps unchanged); a bill cannot close while any line's weight is pending. **Pilot limits:** a weighed item cannot be a deal part choice (`422 weighed_item_in_deal`) and cannot have stock draws (`422 weighed_item_stock_draw`), each checked on item writes and deal writes as a merged-row rule. A weighed item is never a linked option (it is not `piece`, §3.3) | Weight-priced dishes whose weight is only known after the order are sold today; the limits keep deals and stock to known quantities | 01a S59 (a g/ml line gains a pending state; 01a §4.5 change A17) |
| V19 | **Per-branch options (v0.2, G3 8).** `modifier_option_branches { branch_id, option_id, is_offered, price_minor_override }` holds **differences only**: with no row, an option is offered at every branch at its base price. `is_offered: false` with an override → `400`. Effective option price at a branch: branch override, else the option's `price_minor`, else (linked option) the linked item's effective branch price; so a linked option's branch override wins over the linked item's branch price. Edited per group and branch with `PUT /v1/admin/modifier-groups/:id/branches/:branch_id` (§6.12a), the whole list of that group's differences at that branch; versioned per (group, branch) (V13). An entry equal to the default (`is_offered: true`, no override) is not stored (author's call: rows are differences only). The builder omits options not offered there and applies overrides; F1 keeps a required group that this empties | Rent and costs differ by area, so an extra may cost more or not be offered at one branch; rows only for differences keep a three-branch menu small | Replaces v0.1's deferral of per-branch option prices |
| V20 | **Per-item draws stay in `BusinessDayOpened` v2 (v0.2, D-5).** `draws: { [item_id]: { sale_unit, stock_draws } }` is frozen for the open day, as 01a S44 froze `stock_per_sale_unit` per item; `dayDraws(state, item)` reads it and every stock path (02's reservation, 03a, the stock query) uses it, so a config apply never changes a draw mid-day. **Fallback (v0.3, m14):** an item with no frozen entry (tracked after the day opened) uses the config's draws, except a draw whose stock item's frozen `stock_unit` differs from its config `stock_unit`; that draw is not used that day (the item is untracked until the next day open) | One frozen source for every stock path of the day, whether 03a reserves from the order line's copy or not | — |

### 3.2 Variant groups

1. A group shows as one tile at a branch when at least one active member is routed there (builder; a group with no routed member is left out of that branch's snapshot).
2. Tile order: `variant_groups.sort_order`, then id, among the category's items and groups (02 merges `items` without a group and `variant_groups` by `sort_order`, then id). Variant order inside a tile: member `sort_order`, then `item_id`.
3. The order line's display name is the item's own `name` ("Chicken Karahi — Full"); the snapshot also gives `variant_group_id` and `variant_name`, and 02 copies `variant_group_name` (§4.3).
4. Moving the group to another category moves every member, archived ones included (v0.3, M6), in the same transaction (C5: one `menu_item` row each). Restoring a member re-runs "category equals the group's" and "the group is active" on the merged row (§6.5 R1, R1a). An item PATCH that changes `category_id` on a member, or joins a group with another category, → `422 { field: 'category_id', reason: 'category_mismatch' }`.

### 3.3 Validation rules (cloud, beyond 01a §3.3)

| Rule | Error |
|---|---|
| Variant group `name` 1–60, trimmed, unique among active groups (case-insensitive) | `400` / `409 CONFIG_NAME_TAKEN { entity: 'variant_group' }` |
| `variant_name` 1–30 trimmed; required iff `variant_group_id` not null; unique among the group's active members (case-insensitive) | `400` / `409 CONFIG_NAME_TAKEN { entity: 'variant' }` |
| Item's `variant_group_id` references an active group of the tenant; the item's `category_id` equals the group's | `422 not_found` / `archived` / `category_mismatch` |
| Stock item `name` 1–60 unique among active stock items; `stock_unit ∈ piece, g, ml`; `carries_over` boolean (default false) | `400` / `409 { entity: 'stock_item' }` |
| Stock item branch row: `station_id` an active station of that branch; `low_stock_threshold` null or 0 … 1 000 000 (in `stock_unit`) | `422 not_found` / `archived` / `wrong_branch`; `400` |
| `stock_draws`: 0–1 entries; `stock_item_id` an active stock item; unit rule V4 | `400`; `422 not_found` / `archived` / `unit_mismatch` |
| Restoring an item (`archived: false` onto an archived item): its stored draw's stock item is active (v0.4, N8; merged-row rule §6.5 R9) | `422 { field: 'stock_draws.0.stock_item_id', reason: 'archived' }` |
| Modifier group `name` 1–40 unique among active groups; `min_choices` 0 … 50, `max_choices` 1 … 50, `min ≤ max` | `400` / `409 { entity: 'modifier_group' }` |
| Options 1–50; option `name` 1–40 unique among the group's active options (case-insensitive, `lower()` in SQL, m13); `max_quantity` 1 … 20 (default 1); plain option `price_minor` required 0 … 1 000 000 000; linked option `price_minor` null (item's price) or in range; `linked_item_id` an active item whose `sale_unit = 'piece'` and not `requires_weighing`; re-checked for every active option whenever the merged group is active, a restore included (v0.6, Q1; §6.12 R6) | `400` / `409 { entity: 'modifier_option' }` / `422 not_found` / `archived` / `linked_item_not_piece` |
| **Merged rules of a group:** `min_choices ≤ Σ max_quantity` of active options (else `choices_unsatisfiable`); number of `is_default` options ≤ `max_choices` (else `defaults_exceed_max`) | `422 { field: 'min_choices' \| 'options', reason }` |
| Links 0–500; one per `(target_kind, target_id)`; target an active category / variant group / item; `detach` not on a category | `400` (C6 / schema) / `422 not_found` / `archived` |
| **Effective set ≤ 20 groups per item** (V8; a write-time soft limit, M5), checked on a group write that changes links, and on an item write that changes `category_id` or `variant_group_id` | `422 { field: 'links' \| 'category_id' \| 'variant_group_id', reason: 'too_many_groups' }` |
| Deal `name` 1–60 unique among active deals; `price_minor` 0 … 1 000 000 000; category and tax class as 01a items (tax class nullable); windows as 01a S47 | `400` / `409 { entity: 'deal' }` / `422` |
| Parts 1–10; part `quantity` 1 … 1 000 000 (in the choices' `sale_unit`); choices 1–20, one per `item_id`, each an active item, `sort_order` integer (default 0, m5); all choices of a part share `sale_unit` (else `choice_unit_mismatch`); `extra_price_minor` 0 … 1 000 000 000, and 0 when the part has one choice (`400`) | `400` / `422 not_found` / `archived` / `choice_unit_mismatch` |
| Deal branch row: `price_minor_override` null or 0 … 1 000 000 000; `{ is_sold: false }` with an override → `400` | `400` |
| `requires_weighing` (V18): boolean, default false; true only with `sale_unit ∈ g, ml` (checked on the merged row: a `sale_unit` change to `piece` onto a weighed item → `400`) | `400` |
| A weighed item has no stock draws (merged row: `requires_weighing` and `stock_draws` together) | `422 { field: 'stock_draws' \| 'requires_weighing', reason: 'weighed_item_stock_draw' }` |
| A weighed item is not a deal part choice: on deal writes (choice item weighed) and on item writes (`requires_weighing: true` while an active deal part offers the item) | `422 { field: 'parts.N.choices.M.item_id' \| 'requires_weighing', reason: 'weighed_item_in_deal' }` |
| **Deal unit rule from the item side (v0.2, D-3):** an item `sale_unit` change while an active deal part offers the item, when that part would then mix sale units | `409 CONFIG_IN_USE { entity: 'menu_item', id, used_by: { entity: 'deal', ids } }` (01a S22 pattern) |
| **Linked item stays `piece` from the item side (v0.5, P1):** a `sale_unit` change away from `piece`, or `requires_weighing` turned on, while an active option of an active group links the item (§6.5 R10) | `409 CONFIG_IN_USE { entity: 'menu_item', id, used_by: { entity: 'modifier_group', ids } }` (01a S22 pattern) |
| Per-branch option rows (V19): 0–50 entries, one per `option_id`; each an **active** option of this group; `price_minor_override` null or 0 … 1 000 000 000; `is_offered: false` with an override → `400` | `400` (C6 / schema) / `422 { field: 'options.N.option_id', reason: 'not_found' }` |

**Limits, justified:** 50 options (largest realistic group, a drinks list, ~30); 10 parts (a family deal has ~6); 20 effective groups (more cannot be used at speed on a phone); 20 choices per part (a "pick any drink" part); 500 links (a group attached to every item of a 200-item menu, with room).

### 3.4 Order-line rules (02 implements, 01c defines)

1. **Line kinds:** `item` (a plain item or a variant), `option_child` (a linked option's item), `deal` (billing line, no station), `deal_part` (a part's chosen item). Plain options are a list on their `item` or `deal_part` line, never a line.
2. **Child quantity** (`childQuantity`): parent `sale_unit = 'piece'` → option quantity × parent quantity (2 karahis with 3 naan each → 6 naan); parent g/ml → option quantity (a 1.25 kg karahi with 3 naan → 3 naan). A deal part's quantity = part quantity × deal quantity.
3. **Plain option charge** (`optionChargeMinor`): parent `piece` → `price_minor × option quantity × parent quantity`; parent g/ml → `price_minor × option quantity`, **once per line**, never per gram. **Deal part (v0.3, B2):** on a `deal_part` line the parent quantity is part qty × deal qty for a piece part and the **deal quantity** for a g/ml part, i.e. `optionChargeMinor(price, optQty, dealQty, 'piece')`: a g/ml part's option is charged once per deal, never per gram.
4. **Line totals** (`orderLineTotalMinor`, through `lineTotalMinor`; returns `null` for a weighed line whose weight is pending, V18): `item` = `lineTotalMinor(price, qty, sale_unit)` + Σ option charges; `option_child` = `lineTotalMinor(price, qty, 'piece')` + Σ its plain option charges; `deal` = deal price × deal qty + Σ part extra charges (v0.3, B2: piece part `extra × part qty × deal qty`; g/ml part `extra × deal qty`) + Σ part option charges (§3.4.3); `deal_part` billed 0 (it carries `allocated_price_minor`). The bill total is the sum of `line_total_minor` over lines; 05 rounds the bill (§4.4).
5. **Depth ≤ 1** (V9): an `option_child` and a `deal_part` have no children; their linked options are ignored.
6. **Choices check** (`checkOptionChoices`): every option belongs to an effective group of the line's item; quantity 1 … `max_quantity`; per group Σ quantities in `[min_choices, max_choices]`; in a child position no linked option is accepted. **Groups in a child position (v0.3 M1; wording v0.4 N6, identical in V9):** a group with no active plain option configured (`has_plain_options: false`) is not offered in a child position and does not count; any other group is offered there with only its plain options offered at this branch, its linked options never count (offered or not, a group mixing plain and linked options included), and it is satisfiable there only when `min_choices ≤ Σ max_quantity` of those offered plain options; an unsatisfiable group makes the item not orderable in that position. **A linked option is selectable only when its item is orderable as a child** (v0.3 M2, v0.4 N5): `isItemOrderable(itemsById[linked_item_id], groupsById, itemsById, 'child', child quantity, isAvailable)` (a linked item absent from `itemsById` is not orderable, v0.6 Q3), i.e. the item is available for the child quantity (on, inside its and its category's windows, not sold out under `out_of_stock_behaviour`) **and** every effective group of the item is satisfiable in the child position; otherwise a violation, `SubmitOrder` refuses and 02 shows the option disabled. **Groups in the line position (v0.5, P2 decision):** a group is satisfiable for an `item` line only when `min_choices ≤ Σ max_quantity` of its options at this branch, where a linked option counts only when `isItemOrderable(itemsById[linked_item_id], groupsById, itemsById, 'child', 1, isAvailable)` is true and a plain option always counts; so a required group whose only options are linked items that are all sold out, switched off, outside their windows or not orderable as a child makes the parent item **not orderable** (02 shows it unavailable instead of offering a sheet that can never be submitted). The check stops at depth 1: the child-position check never looks at linked options (V9).
7. **`deal` line:** no station, no stage, no reservation; 03a never fires or reserves it; its displayed status is derived from its parts (all served → served; any part voided → partly voided) (§4.4).
8. **Voids (v0.3 M8, v0.4 N1 decision; 04 implements). Refunds on a line never exceed what was billed.**
   - **Refundable amount:** a `deal_part`'s is its `allocated_price_minor` plus its option charges; an `option_child`'s is its `line_total_minor`; a `deal` line's is its `line_total_minor`; an `item` line's is its `line_total_minor` (v0.5, P4; its plain option charges included).
   - **Units:** an `item` line sold by `piece` has one unit per piece; an `item` line sold by g/ml has one unit (voided whole only, v0.5 P4). An `option_child` unit is one piece. A `deal_part` unit is **one deal portion**: on a piece part, one piece (the line has part qty × deal qty units); on a g/ml part, one deal's whole part quantity (the line has deal qty units; a g/ml part is voided per deal, never per gram).
   - **Per-unit voids take shares in void order:** with n units, the k-th unit voided on a line refunds share k of `allocateDealMinor(refundable, [1, …, 1])` (n ones); the last remaining unit always gets the remainder, so the refunds on a fully voided line sum exactly to its refundable amount.
   - **Cascades refund only what is left:** voiding the deal voids every remaining part unit and refunds the deal line total **minus every refund already made on its parts** (their option charges included). Voiding a parent line voids its `option_child` lines, each refunding its own **remaining** refundable amount (refundable − refunds already made on it).
   - **Partial void of a parent (v0.5, P4 decision; v0.6, Q4 decision):** voiding k of the n units of a `piece` parent `item` line voids, for each voided parent unit, that unit's share of each of its `option_child` lines **whose `option_quantity` is set** (§4.3: the option quantity per parent unit, set on a child placed in the parent's `SubmitOrder`), so k × `option_quantity` child units, or the child units still unvoided when fewer remain. A child with `option_quantity: null` (added later, §4.4 02 "Later additions") is not touched by a partial parent void; it is voided only by its own unit voids, when the parent's last unit is voided, or with the parent voided whole. The parent units and the child units are each refunded by the void-order shares above on their own lines. Voiding the last remaining parent unit voids every remaining child unit of every child line. A g/ml parent line is voided whole only; its children follow whole (the cascade above). Example: 2 karahis with 3 naan each (child line 6 naan, `option_quantity` 3); void 1 karahi → 3 naan voided and refunded; a naan added later to the same karahi line (`option_quantity: null`) stays until its own void or the last karahi's.
   - **Already refunded (carried to 04 by name):** 04 persists, per order line, the refunded amount and the number of units voided, and computes every refund from them.

### 3.5 Stock rules (01a S14, S41, S44–S46 re-keyed)

1. The count, add, validity, carry-over, day-frozen unit and level rules are 01a's, applied to a **stock item at a branch**: `carries_over` and `stock_unit` from `stock_items`, `low_stock_threshold` from `stock_item_branches`.
2. A line reserves, per draw, `line quantity × quantity_per_sale_unit` stock units (for a g/ml line drawing from the same unit, the grams sold). 03a serves a line from stock only when **every** draw fits (`canServeFromStock` per draw; pilot: one draw).
3. `BusinessDayOpened` v2 freezes for the day each counted stock item's `stock_unit` and each tracked item's `sale_unit` and draws; a snapshot that changes them takes effect at the next day open (01a S44 rule).
4. The stock page counts **stock items** (one row each) and lists under each the menu items that draw from it; availability On/Off stays per menu item (no deal toggle, v0.3 m9).

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 01a cloud | `withIdempotency`, `bumpConfigVersion`, `writeConfigAudit`, `coversEveryBranch`, the common write script, `menu_items`, `item_routes`, `categories`, `tax_classes`, `stations`, `availability_windows` |
| 01a hub | `branchConfig()`, `onBranchConfigApplied`, command registry, stock commands (re-keyed here), `item_availability`, catch-up registration |
| 01b | `CONFIG_STALE`; B23 version canonicalisation (`@pos/domain/hash`); `stationsOf(staff, 'count_stock')`; `manage-stock` scopes |
| `@pos/domain` | `lineTotalMinor`, `inAvailabilityWindows`, units helpers |

### 4.2 Exposes (later modules may rely only on these)

| Export | Shape | Used by |
|---|---|---|
| `BranchConfigSnapshotSchemaV2`, `SNAPSHOT_SCHEMA_VERSION = 2` | §4.6 | hub, 02, 03a, 03b, 05 |
| `isStockTracked(item)` | `item.stock_draws.length > 0` (V12); replaces 01a's `isStockTracked(config, item)` | hub, 02, 03a |
| `@pos/domain` `menu-lines.ts` (browser-safe) | `childQuantity(optionQty, parentQty, parentSaleUnit)`; `optionChargeMinor(priceMinor, optionQty, parentQty, parentSaleUnit)`; `allocateDealMinor(totalMinor, weightsMinor[]) → number[]` (BigInt inside, throws on a non-safe result like `lineTotalMinor`, m1; also the per-unit void split, M8, with shares taken in void order, N1 §3.4.8); `orderLineTotalMinor(line) → number \| null` (null while a weighed line's weight is pending, V18); `checkOptionChoices(groups, chosen, position: 'line' \| 'child', groupsById, itemsById, isAvailable) → Violation[]` (M1; a linked option through `isItemOrderable(…, 'child', child quantity, …)`, N5; `itemsById` v0.6 Q3); `isGroupSatisfiable(group, position, groupsById, itemsById, isAvailable)` (M1; `'line'`: `min_choices ≤ Σ max_quantity` of the group's options at the branch, a linked option counted only when `isItemOrderable(itemsById[linked_item_id], groupsById, itemsById, 'child', 1, isAvailable)`, v0.5 P2, a linked item absent from `itemsById` not counted; `'child'`: true when `has_plain_options` is false, else `min_choices ≤ Σ max_quantity` of its offered plain options, N6); `isItemOrderable(item, groupsById, itemsById, position, quantity, isAvailable) → boolean` (M1: `isAvailable(item.item_id, quantity)` and every effective group satisfiable in the position; `itemsById` v0.6 Q3); `isDealOrderable(deal, dealQuantity, groupsById, itemsById, isAvailable, inWindows: boolean)` (M1, m16: each choice through `isItemOrderable(…, 'child', part qty × deal qty, …)`). `isAvailable(itemId, quantity) → boolean` (the one signature, v0.6 Q3) is supplied by 02: item On, inside its and its category's windows, not sold out under `out_of_stock_behaviour` for that quantity | 02 (hub and clients), 04, 05, 07 |
| `@pos/engine` (re-keyed, V5) | `stockOf(state, stockItemId)`; `countIsValid(entry, dayStartMs, stockItem)`; `availableStock(state, stockItemId, dayStartMs, stockItem)`; `stockLevel(state, stockItemId, dayStartMs, stockItem)`; `dayStockUnit(state, stockItem)`; `dayDraws(state, item) → { sale_unit, stock_draws }` (fallback V20, m14); `canServeFromStock(available, quantity, quantityPerSaleUnit)` and `saleUnitsAvailable(available, quantityPerSaleUnit)` unchanged in meaning | hub, 02, 03a |
| Events | `StockSet` v2 `{ stock_item_id, on_hand, unit }`; `StockAdded` v2 `{ stock_item_id, quantity, unit }`; `BusinessDayOpened` v2 `{ business_date, stock_units: { [stock_item_id]: unit }, draws: { [item_id]: { sale_unit, stock_draws: [{ stock_item_id, quantity_per_sale_unit }] } } }`. Streams: `stock` / stock_item_id; `hub` / branch_id | 02, 03a, 05, 06 |
| Catch-up parts | `stock.items` keyed by `stock_item_id` (§6.21); `availability` unchanged (no deal toggle, m9) | 02 clients |
| `config_audit` entities | `variant_group`, `stock_item`, `stock_item_branch`, `modifier_group`, `deal`, `deal_branch`; actions add `branch_set`, `branch_removed` | 06, 07 |

### 4.3 Order-line contract: `ItemAdded` v1 payload (02 owns the schema file and implements this exactly)

One `ItemAdded` per order line, in the same batch as `OrderPlaced` (F §5.9 step 7). Children follow their parent in the batch. Every field is a D25 copy taken from `branchConfig()` at order time; a later config change never alters it.

```ts
ItemAddedV1 = {
  order_id: string, order_item_id: string,
  parent_order_item_id: string | null,               // null for 'item' and 'deal'
  line_kind: 'item' | 'option_child' | 'deal' | 'deal_part',
  item_id: string | null,                            // null only for 'deal'
  deal_id: string | null,                            // 'deal' and 'deal_part'
  deal_part_id: string | null,                       // 'deal_part'
  option_id: string | null,                          // 'option_child': the linked option it came from
  option_quantity: number | null,                    // v0.6 Q4, 'option_child' placed in its parent's SubmitOrder: the
                                                     // option quantity per parent unit (§3.4.2); null on every other kind
                                                     // and on a child added later (§4.4 02); read by partial voids (§3.4.8)
  variant_group_id: string | null, variant_group_name: string | null, variant_name: string | null,
  name: string,                                      // item or deal name
  category_id: string,                               // m12: the item's; the deal's on 'deal' and 'deal_part'
  requires_weighing: boolean,                        // V18; false for every kind but a weighed 'item' line
  quantity: number | null,                           // integer in sale_unit; 'deal': count of deals;
                                                     // null only when requires_weighing and the weight is pending
  sale_unit: 'piece' | 'g' | 'ml',                   // 'deal': 'piece'
  price_minor: number,                               // item: effective branch price; option_child: option's effective branch
                                                     // price (V19); deal: deal's effective branch price; deal_part: the
                                                     // chosen item's effective branch price (display only; the allocation
                                                     // weight is the reference choice's price, M9)
  extra_price_minor: number | null,                  // deal_part: the choice's extra (per piece; per deal on a g/ml part, B2)
  allocated_price_minor: number | null,              // deal_part only (V11 c), extra included
  tax_class_id: string | null,                       // deal_part: the deal's (tax is on the deal line, V11 b)
  station_id: string | null, program_id: string | null, stock_program_id: string | null,
  program_cook_time_ms: number | null,               // B1: batch route only, from the snapshot's programs[]
  stock_program_cook_time_ms: number | null,         // (D25, 01a §4.4); null off batch and on 'deal'
  serve_mode: 'immediate' | 'sync' | null, prep_buffer_ms: number | null,
  cook_time_ms: number | null, stock_time_ms: number | null,
  out_of_stock_behaviour: 'cook_fresh' | 'sold_out' | null,   // all null for 'deal'
  stock_draws: { stock_item_id: string, quantity: number }[],  // stock units for the whole line (§3.5.2); [] for 'deal'
  options: { option_id: string, modifier_group_id: string, name: string,
             price_minor: number, quantity: number, charge_minor: number }[],  // plain options; [] on 'deal'
  line_total_minor: number | null,                   // §3.4.4; 'deal_part' 0; null while a weight is pending (V18)
  kitchen_note: string | null                        // 02 (≤ 80 chars)
}
```

Example (**abridged**: only the keys that matter are shown; on the wire every key above is present on every line, null or `[]` where it does not apply). Family karahi deal Rs 3,200 at T12, parts Full Chicken Karahi (Rs 2,200), Naan × 4 (Rs 30), Lassi jug (Rs 750). Weights 220 000, 12 000, 75 000 (sum 307 000); allocation of 320 000: 229 315, 12 508, 78 177. The naan part's weight is its reference choice, plain Naan at Rs 30 × 4, whichever naan is chosen (M9).

```json
[
 { "line_kind": "deal", "order_item_id": "01JD…L1", "parent_order_item_id": null, "item_id": null,
   "deal_id": "01JC…D1", "deal_part_id": null, "name": "Family karahi deal", "quantity": 1, "sale_unit": "piece",
   "price_minor": 320000, "tax_class_id": "01JC…X1", "station_id": null, "serve_mode": null,
   "stock_draws": [], "options": [], "allocated_price_minor": null, "line_total_minor": 320000 },
 { "line_kind": "deal_part", "order_item_id": "01JD…L2", "parent_order_item_id": "01JD…L1",
   "item_id": "01JC…I2", "deal_id": "01JC…D1", "deal_part_id": "01JC…P1", "variant_group_name": "Chicken Karahi",
   "variant_name": "Full", "name": "Chicken Karahi — Full", "quantity": 1, "sale_unit": "piece",
   "price_minor": 220000, "extra_price_minor": 0, "allocated_price_minor": 229315, "tax_class_id": "01JC…X1",
   "station_id": "01JC…S1", "serve_mode": "sync", "cook_time_ms": 1500000,
   "stock_draws": [ { "stock_item_id": "01JC…K1", "quantity": 1000 } ],
   "options": [ { "option_id": "01JC…O2", "modifier_group_id": "01JC…M1", "name": "Normal",
                  "price_minor": 0, "quantity": 1, "charge_minor": 0 } ],
   "line_total_minor": 0 }
]
```

**Rules for 02:** one `ItemAdded` per order line with its `quantity` (D-2, §4.4 02 row: 02 decides whether a line of n pieces is one order item or n; 01c's child-line and allocation rules assume one line with quantity and are re-checked if 02 splits). StockReserved (03a) is `{ stock_item_id, order_item_id, quantity }` (V5). **Weight entered later (v0.3, M7):** the event 02 appends when a pending weight is entered carries at least `{ order_item_id, quantity, line_total_minor }`, with `quantity` in S59 steps (50 g / 50 ml) and `line_total_minor` = `orderLineTotalMinor` over the **`ItemAdded` copy** (its `price_minor` and `options` as copied, D25), never re-priced from the current config. 04, 05, 07 and R28 read a weighed line's final quantity and total from that event.

### 4.4 Requirements carried to other modules

| To | Requirement |
|---|---|
| 02 | Implement §4.3 exactly; offer variants as a required one-of on the group tile; effective groups from `items[].modifier_group_ids`; `checkOptionChoices` on the hub and client; `isDealOrderable` for deals. **Empty required groups (F1):** the snapshot keeps a required group (`min_choices ≥ 1`) whose options are all absent at this branch, with `options: []`; `isGroupSatisfiable` is then false and the item is not orderable there (optional empty groups are not in the snapshot). **Defaults (G3 5):** a default option is preselected but changeable; a group with a default is always shown on the item's order sheet, never hidden behind the default. **Line split (D-2):** 02 decides whether a line of n pieces is one order item or n; 01c's child-line and allocation rules assume one line with quantity and are re-checked if 02 splits. **Weighed lines (V18):** 02 owns the pending-weight line and a `SetLineWeight`-style command (permission, who may enter a weight, audit); `quantity` and `line_total_minor` stay null until then; its event carries at least `{ order_item_id, quantity, line_total_minor }` computed from the `ItemAdded` copy (M7, §4.3). **Linked options (M2, N5):** selectable only when `isItemOrderable(its item, groupsById, itemsById, 'child', child quantity, isAvailable)` with `isAvailable(itemId, quantity)` as §4.2 (v0.6 Q3) (available **and** its groups satisfiable in the child position); shown disabled otherwise; `SubmitOrder` refuses through `checkOptionChoices`. **Required groups of linked options (v0.5, P2):** a required group whose only options are linked items that are all unavailable makes the parent item not orderable (`isGroupSatisfiable(g, 'line', …)`, §3.4.6); 02 shows the item unavailable. **Child position (M1, N6):** offer only groups with `has_plain_options`, with their offered plain options only (§3.4.6); use `isItemOrderable` / `isDealOrderable` for the position. **Batch copy (B1):** copy `program_cook_time_ms` / `stock_program_cook_time_ms` from `programs[]` (archived programs included, S22); 02's `ItemAdded` tests assert the copy. **Later additions:** whether a child ("one more naan") can be added to an already-submitted parent line, and which permission and table-lock rules apply, is 02's decision; if allowed, it is a new `ItemAdded` with the existing `parent_order_item_id` and `option_quantity: null` (v0.6 Q4), priced at the current config (D25 for the new line), and `max_quantity` is checked over the parent's children. **`option_quantity` (v0.6, Q4):** set on every `option_child` placed in its parent's `SubmitOrder` (the option quantity per parent unit, §3.4.2), null otherwise |
| 03a | Deal parts and option children are separate station lines with their own `serve_mode` (sync parts land together as any sync items do); the `deal` line has no station, stage or reservation and is never fired; reserve per draw (§3.5.2); `StockReserved` / `StockReleased` v1 keyed by `stock_item_id`. A weighed line with its weight pending is fired normally (its cook time is the item's; it has no stock draw, V18). At a batch station the cook times come from the line's copied `program_cook_time_ms` / `stock_program_cook_time_ms` (B1), never from config |
| 03b | A child's ticket shows its parent's name and table: "Naan ×3 · for Chicken Karahi — Full · T12"; a deal part shows the deal name; plain options print under their line (E0-TPL AC2) |
| 04 | Rules in §3.4.8 (v0.3 M8, v0.4 N1): **refunds on a line never exceed what was billed.** A `deal_part` or `option_child` line may be voided per unit (a `deal_part` unit is one deal portion: one piece on a piece part, one deal's whole part quantity on a g/ml part, never per gram); the k-th unit voided gets share k of `allocateDealMinor(the line's refundable amount, [1, …, 1])` and the last remaining unit the remainder; a part's refundable amount is its `allocated_price_minor` plus its option charges, a child's its `line_total_minor`. Voiding a parent line voids its `option_child` lines, each refunding its remaining refundable amount; voiding the deal voids every remaining part unit and refunds the deal line total **minus every refund already made on its parts**. **Partial parent voids (v0.5, P4; v0.6, Q4):** voiding k units of a `piece` parent `item` line voids k × `option_quantity` units of each `option_child` line whose `option_quantity` is set (or those still unvoided), each line refunded by its own void-order shares; a child with `option_quantity: null` (added later) is voided only by its own unit voids, with the parent's last unit, or with the whole parent; a g/ml parent line is voided whole only, its children following. **Already refunded:** 04 must persist, per order line, the refunded amount and the number of units voided. A weighed line's total comes from its weight event (M7); a line still pending refunds 0. Approval rules are 04's. The deal line's status is derived (§3.4.7) |
| 05 | Tax: a `deal` line with the deal's `tax_class_id` on its whole `line_total_minor`; an `option_child` with its own tax class; never tax from `allocated_price_minor`. Bill rounding is 05's. **Refuse bill close while any line's weight is pending** (V18); a weighed line's total comes from its weight event (M7) |
| 07 | Sales by item read `deal_part.allocated_price_minor` and `item_id`; a part's plain option charges count under the part's item (m12); sales by category read the copied `category_id` (m12); a weighed line's quantity and total come from its weight event (M7); never recompute |
| Recipe-based inventory module (proposed R28) | **What 01c guarantees now:** every variant is an `item_id`; every option and deal part has its own stable ULID, never reused (V14); `ItemAdded` carries the variant `item_id`, each chosen option id, each child line and each stock draw (`stock_item_id` + quantity), so depletion can be computed from events. **Its scope, as the developer wants it:** raw-ingredient use per variant (bun 1, cheese 40 g on Large) and per extra or topping (recipe deltas, G3 1 and 4); ingredients as stock items of kind `'ingredient'` (base unit g/ml/piece, optional cost per unit, per-branch low-stock threshold, one ingredient in many recipes); prep / sub-recipes (batch preparations with a yield, used as ingredients); a recipe per sellable item (per variant); recipe deltas per modifier option (Spicy +5 g chilli, No onion −onion; a linked extra uses its item's recipe); batch recipes for pot items feeding the `'prepared'` stock items; depletion from order events (voids reversed) plus stock movements (receiving, wastage, counts, transfers); theoretical vs actual variance (leakage report); low-stock alerts before an ingredient runs out; reorder suggestions later; "no recipe → not on the menu" as a **setting** (block / warn / off; pilot default warn, R18). **When draws become multi-row, the write that replaces them requires `expected_version`** (V13) |

### 4.5 Changes to other specs (R26)

The target specs are **not** edited by this draft; on approval each is bumped with a changelog entry and an inline "Changed by 01c" marker.

**01a → v2.0 (breaking, V1).**

| # | 01a section | Change | Reason |
|---|---|---|---|
| A1 | §1 out of scope; S12 | Variants are variant groups (V2); `group_label` replaced | V2 |
| A2 | S14, S41, S44, S45, S46 | Stock keyed by stock item; units, `carries_over` on `stock_items`; threshold on `stock_item_branches`; `stock_per_sale_unit` → `stock_draws.quantity_per_sale_unit`; tracked rule **changed** (V12, v0.3 m7): a route with a stock time or stock program no longer tracks an item on its own; it also needs a stock draw to a stock item counted at the branch | V3–V5, V12 |
| A3 | S28, §4.3 | Snapshot schema 2 (§4.6) replaces schema 1 | V12 |
| A4 | §3.3 | Item unit rules move to draws (V4); new rules §3.3 here | V4 |
| A5 | §4.2 | Engine function signatures re-keyed; `isStockTracked(config, item)` → `isStockTracked(item)` (callers: hub `queries/stock.ts`, `commands/open-business-day.ts`, `commands/set-precooked-stock.ts`, `ws/restaurant-catch-up.ts`); event table: `StockSet` v2, `StockAdded` v2, `BusinessDayOpened` v2 | V5, V12 |
| A6 | §4.4 rows 01c, 02, 03a | Replaced by this spec's §4.3–§4.4; **the 01a §4.4 02/03a batch cook-time copy is kept** (`program_cook_time_ms`, `stock_program_cook_time_ms` in `ItemAdded`, v0.3 B1) | B1 |
| A7 | §4.5 | Catch-up `stock` keyed by stock item | V5 |
| A8 | §5.1 hub | None (v0.3, m9: no hub migration) | — |
| A9 | §5.2 cloud | `menu_items.group_label`, `stock_unit`, `stock_per_sale_unit`, `low_stock_threshold`, `carries_over` deprecated (expand/contract; dropped later); `availability_windows` gains `deal_id` | V2, V4 |
| A10 | §6.9, §6.12, §6.13, §6.15 | New in-use checks (V16) | V16 |
| A11 | §6.11, §6.14, §6.15 | Item body and menu read change (§6.3–§6.5 here) | V2, V4 |
| A12 | §6.1, §6.23 | Serve snapshot 2 | V12 |
| A13 | §6.17, §6.17a, §6.18a, §6.19 | Re-keyed to stock items (§6.18–§6.21 here) | V5 |
| A14 | §8.1, §8.2 | Owner item form (variant group, stock draw, no unit fields), new owner views; stock page per stock item | V2–V4 |
| A15 | §9 | `CONFIG_REFERENCE_INVALID.reason` adds `category_mismatch`, `unit_mismatch`, `linked_item_not_piece`, `choices_unsatisfiable`, `defaults_exceed_max`, `too_many_groups`, `choice_unit_mismatch`; `STOCK_NOT_TRACKED` is no longer returned by the stock commands (kept in the catalogue, never reused) | §9 |
| A16 | §10 tests | Numbered tests to rewrite or re-key (cost below) | — |
| A17 | S59, §3.3, §4.3, §5.2, §6.14, §6.15 | `menu_items.requires_weighing` (V18): a g/ml line may have its weight pending; new item field and its rules; snapshot field | V18 |
| A18 | §6.15 | Merged-row rules added: weighed item vs draws and deals (V18); `sale_unit` change vs deal parts → `409 CONFIG_IN_USE` (D-3) | V18, D-3 |

**01b → v1.2.**

| # | 01b section | Change |
|---|---|---|
| B1 | B20, §4.4 rows 9–11 | `my_stations` on the stock page and the stock commands uses the **stock item's** station at this branch (`stock_item_branches.station_id`); `SetItemAvailability` keeps the item's route station |
| B2 | §5.1 audit CHECKs | Widened again by 01c's migration (entities and actions §4.2) |
| B3 | Tests 9, 10, 11 | Re-keyed to stock items |

**Foundation (frozen, D64):** no edit except appending the new error codes (§9) to the §6.2 status map. Overrides named in V5 (F §4.7, F §5.9 step 5).

**README (proposed rows, applied on approval):**
- Module map row 01c → this spec; carried rows "To 01c" closed; the 02 "Mid-service safety" row now points at 01c §4.3 (the order line copies `stock_draws` and `quantity_per_sale_unit` instead of `stock_per_sale_unit`).
- **R28 (proposed): Recipe-based inventory is its own module, after 02 and 04.** Its stories are refined with the owner first; its scope is the §4.4 row; 01c guarantees the hooks listed there.
- R-row for V1 (the pre-pilot breaking-change policy) and V13 (versioned writes on new tables).
- **Carried row (later module, not 01c; G3 6): deal suggestion during ordering.** When an order's lines match a deal, prompt the cashier to convert and show the saving; needs item cost for a margin check; candidate paid add-on.

**Cost of the breaking changes (built files and numbered tests).** Line counts are not estimated; the plan sizes each.

| Area | Files |
|---|---|
| Events | `packages/events/src/config.ts` (V2 schema, `isStockTracked`), `events/stock/StockSet.v2.ts`, `StockAdded.v2.ts`, `events/hub/BusinessDayOpened.v2.ts` (each with `upcastFromPrevious`, the existing mechanism in `registry.ts`, as `StaffDirectoryApplied.v2.ts`), `fixtures/` (new `.v2.json`; `.latest.json` become v2; `.v1.json` unchanged), `admin/restaurant.ts` (item body incl. `requires_weighing`, menu response), `admin/hub.ts` (stock command payloads and stock query response keyed by `stock_item_id`), new `admin/menu-variants.ts`, `index.ts`; tests `codecs.test.ts`, `fixtures.test.ts`, `config.test.ts` |
| Engine | `packages/engine/src/stock.ts`, `state.ts`, `apply-event.ts`, `index.ts`, `version.ts` (bump `ENGINE_STATE_VERSION`, D62), new `fixtures/engine-state.v2.json` and `engine-log.v2.json` (the `.v1.json` files stay); tests `stock.test.ts`, `business-day.test.ts` |
| Domain | `packages/domain/src/errors.ts`, new `menu-lines.ts` (+ test) |
| Cloud | migration `0006_menu_variants.sql`; `modules/restaurant/{service,repository,routes,schemas}.ts`; `modules/config-sync/builder.ts`; new `modules/menu-variants/{routes,service,repository,versions}.ts`; `lib/config-audit.ts` (`AuditEntity`, actions); `cli/seed-demo.ts`; `test/helpers/route-cases.ts` (C7) |
| Hub | `commands/set-precooked-stock.ts`, `add-precooked-stock.ts`, `open-business-day.ts`, `set-item-availability.ts` (imports the scope helper from `set-precooked-stock.ts`); `queries/stock.ts`; `ws/restaurant-catch-up.ts`; `sync/boot-steps.ts` (folds through `parseEvent`, so upcast v1 events need no code change; test 114). No hub migration (m9) |
| Client | `features/admin/stock/{StockTable,AddSheet,main,StockApp,StartDay}.tsx`, `features/admin/stock/{draft,badges}.ts`; tests `BusinessDay.test.tsx`, `StockTable.test.tsx`, `stock-pages.test.tsx`; `features/owner/menu/{ItemForm,MenuView}.tsx`; `features/owner/stock-counting/StockCountingView.tsx`; `api/hub-admin.ts`, `api/cloud-admin.ts`; `i18n/en.ts`, `ur.ts`; new owner views (§8) |
| 01a numbered tests to rewrite or re-key (each checked against 01a §10, v0.3 m6) | 4 (snapshot contents, schema 2), 41 (group_label), 59, 60, 61, 66, 67, 72, 73, 77, 89, 91, 93, 116, 128, 129, 130, 131, 132, 133, 134, 140 (statement bound ≤ 13 → ≤ 22), 143 and 145 (`BusinessDayOpened` v2 payload), 147, 148, 149, 152, 156, 157, 158, 166, 167, 171 (34 tests) |
| 01b numbered tests | 9, 10, 11 |

---

### 4.6 Snapshot schema 2 (`BranchConfigSnapshotSchemaV2`)

Unchanged top-level fields and `floors`, `stations`, `tax_classes`, `categories` as schema 1. Arrays sorted by `sort_order`, then id (stock items by name lowercased with `toLowerCase()`, then id, compared by JavaScript string order in the builder, never by database collation, so `canonicalJson` is stable); only active rows (stations, programs, tax classes keep archived rows as in 01a S22). Not `.strict()`.

```json
{
  "snapshot_schema_version": 2,
  "config_version": 57, "branch_id": "01JBF2A0000000000000BR0001", "currency_code": "PKR",
  "tax_enabled": false, "day_stale_after_hours": 16, "day_min_gap_hours": 4,
  "floors": [], "stations": [], "tax_classes": [], "categories": [],
  "variant_groups": [
    { "variant_group_id": "01JC…V1", "category_id": "01JC…C1", "name": "Chicken Karahi",
      "description": null, "sort_order": 1 } ],
  "stock_items": [
    { "stock_item_id": "01JC…K1", "name": "Karahi pot", "stock_unit": "g",
      "carries_over": false, "station_id": "01JC…S1", "low_stock_threshold": 1000 } ],
  "modifier_groups": [
    { "modifier_group_id": "01JC…M1", "name": "Spice level", "min_choices": 1, "max_choices": 1, "sort_order": 1, "has_plain_options": true,
      "options": [ { "option_id": "01JC…O1", "name": "Mild", "price_minor": 0, "max_quantity": 1,
                     "is_default": false, "linked_item_id": null, "sort_order": 1 },
                   { "option_id": "01JC…O2", "name": "Normal", "price_minor": 0, "max_quantity": 1,
                     "is_default": true, "linked_item_id": null, "sort_order": 2 } ] },
    { "modifier_group_id": "01JC…M2", "name": "Bread", "min_choices": 0, "max_choices": 6, "sort_order": 2, "has_plain_options": false,
      "options": [ { "option_id": "01JC…O5", "name": "Naan", "price_minor": 3000, "max_quantity": 6,
                     "is_default": false, "linked_item_id": "01JC…I9", "sort_order": 1 } ] } ],
  "items": [
    { "item_id": "01JC…I1", "category_id": "01JC…C1", "variant_group_id": "01JC…V1", "variant_name": "Half",
      "name": "Chicken Karahi — Half", "description": null, "sort_order": 1,
      "price_minor": 115000, "tax_class_id": "01JC…X1", "serve_mode": "sync",
      "prep_buffer_ms": 0, "cook_time_ms": 1200000, "stock_time_ms": 300000,
      "out_of_stock_behaviour": "cook_fresh", "sale_unit": "piece", "requires_weighing": false,
      "stock_draws": [ { "stock_item_id": "01JC…K1", "quantity_per_sale_unit": 500 } ],
      "availability_windows": [], "station_id": "01JC…S1", "program_id": null, "stock_program_id": null,
      "modifier_group_ids": [ "01JC…M1", "01JC…M2" ] } ],
  "deals": [
    { "deal_id": "01JC…D1", "category_id": "01JC…C3", "name": "Family karahi deal", "description": null,
      "sort_order": 1, "price_minor": 320000, "tax_class_id": "01JC…X1", "availability_windows": [],
      "parts": [ { "deal_part_id": "01JC…P1", "quantity": 1, "sort_order": 1,
                   "choices": [ { "item_id": "01JC…I2", "extra_price_minor": 0, "sort_order": 1 } ] },
                 { "deal_part_id": "01JC…P2", "quantity": 4, "sort_order": 2,
                   "choices": [ { "item_id": "01JC…I9", "extra_price_minor": 0, "sort_order": 1 },
                                { "item_id": "01JC…I10", "extra_price_minor": 3000, "sort_order": 2 } ] } ] } ]
}
```

Builder rules:
1. `items[].price_minor`, `deals[].price_minor` are the branch's effective prices (S57); `items[].requires_weighing` is copied (V18).
2. **Options at a branch (V19):** an option with `is_offered: false` there is left out; a linked option whose item is not routed there is left out; **backstop (v0.6, Q1, defence in depth):** a linked option whose item is archived, not `sale_unit = 'piece'` or `requires_weighing` is left out (the write rules §6.5 R4, R10 and §6.12 R6 keep this from arising; a required group so emptied is kept with `options: []`, rule 3); `options[].price_minor` is the effective branch price: branch override, else the option's `price_minor`, else the linked item's effective branch price.
3. **Groups (F1):** a group left with no options at this branch is **kept with `options: []` when it is required** (`min_choices ≥ 1`), so `isGroupSatisfiable` makes its items not orderable there; an optional empty group is left out of `modifier_groups[]` and of every `modifier_group_ids`. `modifier_group_ids` is otherwise the resolved effective set (V8). (v0.3) `modifier_groups[]` holds only groups referenced by some item's `modifier_group_ids` in this snapshot (m5); `has_plain_options` is true when the group has at least one active plain option configured, offered here or not (M1); `modifier_group_ids` has **no maximum** in `BranchConfigSnapshotSchemaV2`, and the builder never truncates or fails on it (M5).
4. `stock_items[]` holds stock items counted at this branch; `stock_draws` only tracked draws (V12).
5. Deals and choices omitted per V11 e; choices ordered by `sort_order`, then `item_id` (m5); `variant_groups[]` only groups with a routed member.
6. A link whose target (category, variant group, item) is archived is ignored (m15).

---

## §5. Data model and migrations

### 5.1 Cloud — `0006_menu_variants.sql` (expand; one transaction)

```sql
CREATE TABLE variant_groups (
  tenant_id TEXT NOT NULL REFERENCES tenants, variant_group_id TEXT NOT NULL,
  category_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT CHECK (length(description) <= 300),
  sort_order INT NOT NULL DEFAULT 0, archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, variant_group_id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES categories);
CREATE UNIQUE INDEX variant_groups_active_name ON variant_groups (tenant_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX variant_groups_category ON variant_groups (tenant_id, category_id) WHERE archived_at IS NULL;  -- category archive check

ALTER TABLE menu_items ADD COLUMN variant_group_id TEXT, ADD COLUMN variant_name TEXT,
  ADD CONSTRAINT menu_items_variant_pair CHECK ((variant_group_id IS NULL) = (variant_name IS NULL)),
  ADD CONSTRAINT menu_items_variant_group_fk FOREIGN KEY (tenant_id, variant_group_id) REFERENCES variant_groups;
CREATE UNIQUE INDEX menu_items_variant_name ON menu_items (tenant_id, variant_group_id, lower(variant_name))
  WHERE archived_at IS NULL AND variant_group_id IS NOT NULL;            -- variant name unique in its group; members by group

ALTER TABLE menu_items ADD COLUMN requires_weighing BOOLEAN NOT NULL DEFAULT false,      -- V18
  ADD CONSTRAINT menu_items_weighing_unit CHECK (NOT requires_weighing OR sale_unit IN ('g','ml'));

CREATE TABLE stock_items (
  tenant_id TEXT NOT NULL REFERENCES tenants, stock_item_id TEXT NOT NULL,
  name TEXT NOT NULL,                                                    -- v0.3 m8: no kind (R28 adds it)
  stock_unit TEXT NOT NULL CHECK (stock_unit IN ('piece','g','ml')),
  carries_over BOOLEAN NOT NULL DEFAULT false,
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, stock_item_id));
CREATE UNIQUE INDEX stock_items_active_name ON stock_items (tenant_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE stock_item_branches (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, stock_item_id TEXT NOT NULL,
  station_id TEXT NOT NULL, low_stock_threshold INT CHECK (low_stock_threshold BETWEEN 0 AND 1000000),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, stock_item_id),                     -- snapshot: one branch's stock items
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items,
  FOREIGN KEY (tenant_id, branch_id, station_id) REFERENCES stations);
CREATE INDEX stock_item_branches_station ON stock_item_branches (tenant_id, branch_id, station_id);  -- station archive check

CREATE TABLE stock_draws (
  tenant_id TEXT NOT NULL, item_id TEXT NOT NULL, stock_item_id TEXT NOT NULL,
  quantity_per_sale_unit INT NOT NULL CHECK (quantity_per_sale_unit BETWEEN 1 AND 1000000),
  PRIMARY KEY (tenant_id, item_id, stock_item_id),                       -- an item's draws (snapshot, menu read)
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items,
  FOREIGN KEY (tenant_id, stock_item_id) REFERENCES stock_items);
CREATE INDEX stock_draws_stock_item ON stock_draws (tenant_id, stock_item_id);  -- drawers list, stock item archive check

CREATE TABLE modifier_groups (
  tenant_id TEXT NOT NULL REFERENCES tenants, modifier_group_id TEXT NOT NULL, name TEXT NOT NULL,
  min_choices INT NOT NULL CHECK (min_choices BETWEEN 0 AND 50),
  max_choices INT NOT NULL CHECK (max_choices BETWEEN 1 AND 50), CHECK (min_choices <= max_choices),
  sort_order INT NOT NULL DEFAULT 0, archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, modifier_group_id));
CREATE UNIQUE INDEX modifier_groups_active_name ON modifier_groups (tenant_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE modifier_options (
  tenant_id TEXT NOT NULL, option_id TEXT NOT NULL, modifier_group_id TEXT NOT NULL,
  name TEXT NOT NULL, price_minor BIGINT CHECK (price_minor BETWEEN 0 AND 1000000000),
  max_quantity INT NOT NULL DEFAULT 1 CHECK (max_quantity BETWEEN 1 AND 20),
  is_default BOOLEAN NOT NULL DEFAULT false, linked_item_id TEXT, sort_order INT NOT NULL DEFAULT 0,
  CHECK (linked_item_id IS NOT NULL OR price_minor IS NOT NULL),          -- a plain option has a price
  archived_at BIGINT,
  PRIMARY KEY (tenant_id, option_id),                                    -- option ids are tenant-unique, never reused
  FOREIGN KEY (tenant_id, modifier_group_id) REFERENCES modifier_groups,
  FOREIGN KEY (tenant_id, linked_item_id) REFERENCES menu_items);
CREATE INDEX modifier_options_group ON modifier_options (tenant_id, modifier_group_id, sort_order);  -- read, rewrite
-- Option names: unique among the group's active options by lower(name), checked by one SQL statement under the
-- group lock (V14, m13); no partial unique index, because the upsert of a rename swap would trip it mid-statement.
CREATE INDEX modifier_options_linked_item ON modifier_options (tenant_id, linked_item_id)
  WHERE linked_item_id IS NOT NULL AND archived_at IS NULL;              -- item archive check (V16)

CREATE TABLE modifier_option_branches (                                  -- V19: differences only
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, option_id TEXT NOT NULL,
  is_offered BOOLEAN NOT NULL,
  price_minor_override BIGINT CHECK (price_minor_override BETWEEN 0 AND 1000000000),
  CHECK (is_offered OR price_minor_override IS NULL),
  CHECK (NOT (is_offered AND price_minor_override IS NULL)),             -- a default entry is not stored
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, option_id),                         -- snapshot of one branch; PUT reads a group's rows (option_id = ANY)
  FOREIGN KEY (tenant_id, option_id) REFERENCES modifier_options,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);

CREATE TABLE modifier_group_links (
  tenant_id TEXT NOT NULL, modifier_group_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('category','variant_group','item')),
  target_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('attach','detach')),
  CHECK (NOT (target_kind = 'category' AND mode = 'detach')),
  PRIMARY KEY (tenant_id, modifier_group_id, target_kind, target_id),
  FOREIGN KEY (tenant_id, modifier_group_id) REFERENCES modifier_groups);
-- target_id is polymorphic: checked by the service (C1), not by a foreign key.
CREATE INDEX modifier_group_links_target ON modifier_group_links (tenant_id, target_kind, target_id);  -- effective-set check on item writes

CREATE TABLE deals (
  tenant_id TEXT NOT NULL REFERENCES tenants, deal_id TEXT NOT NULL,
  category_id TEXT NOT NULL, tax_class_id TEXT, name TEXT NOT NULL,
  description TEXT CHECK (length(description) <= 300), sort_order INT NOT NULL DEFAULT 0,
  price_minor BIGINT NOT NULL CHECK (price_minor BETWEEN 0 AND 1000000000),
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, deal_id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES categories,
  FOREIGN KEY (tenant_id, tax_class_id) REFERENCES tax_classes);
CREATE UNIQUE INDEX deals_active_name ON deals (tenant_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX deals_category ON deals (tenant_id, category_id) WHERE archived_at IS NULL;    -- category archive check
CREATE INDEX deals_tax_class ON deals (tenant_id, tax_class_id) WHERE archived_at IS NULL;  -- tax class archive check

CREATE TABLE deal_parts (
  tenant_id TEXT NOT NULL, deal_part_id TEXT NOT NULL, deal_id TEXT NOT NULL,
  quantity INT NOT NULL CHECK (quantity BETWEEN 1 AND 1000000), sort_order INT NOT NULL DEFAULT 0,
  archived_at BIGINT,
  PRIMARY KEY (tenant_id, deal_part_id),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals);
CREATE INDEX deal_parts_deal ON deal_parts (tenant_id, deal_id, sort_order);

CREATE TABLE deal_part_choices (
  tenant_id TEXT NOT NULL, deal_part_id TEXT NOT NULL, item_id TEXT NOT NULL,
  extra_price_minor BIGINT NOT NULL DEFAULT 0 CHECK (extra_price_minor BETWEEN 0 AND 1000000000),
  sort_order INT NOT NULL DEFAULT 0,                                     -- v0.3 m5: display order, reference choice
  PRIMARY KEY (tenant_id, deal_part_id, item_id),
  FOREIGN KEY (tenant_id, deal_part_id) REFERENCES deal_parts,
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items);
CREATE INDEX deal_part_choices_item ON deal_part_choices (tenant_id, item_id);  -- item archive check (V16; joined to active parts)

CREATE TABLE deal_branches (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, deal_id TEXT NOT NULL,
  price_minor_override BIGINT CHECK (price_minor_override BETWEEN 0 AND 1000000000),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, deal_id),                           -- snapshot: one branch's deals
  FOREIGN KEY (tenant_id, deal_id) REFERENCES deals,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);

ALTER TABLE availability_windows ADD COLUMN deal_id TEXT,
  ADD CONSTRAINT availability_windows_deal_fk FOREIGN KEY (tenant_id, deal_id) REFERENCES deals;
ALTER TABLE availability_windows DROP CONSTRAINT availability_windows_check;   -- real name read at build step 1 (01b D-5)
ALTER TABLE availability_windows ADD CONSTRAINT availability_windows_one_target
  CHECK (num_nonnulls(item_id, category_id, deal_id) = 1);
CREATE INDEX availability_windows_deal ON availability_windows (tenant_id, deal_id, start_ms) WHERE deal_id IS NOT NULL;

-- audit: entities and actions widen (expand)
ALTER TABLE config_audit DROP CONSTRAINT config_audit_entity_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_entity_check CHECK (entity IN (
  'floor','table','station','batch_program','tax_class','category','menu_item','item_route','branch_settings',
  'staff','role','responsibility','branch','owner_user',
  'variant_group','stock_item','stock_item_branch','modifier_group','deal','deal_branch'));
ALTER TABLE config_audit DROP CONSTRAINT config_audit_action_check;
ALTER TABLE config_audit ADD CONSTRAINT config_audit_action_check CHECK (action IN (
  'create','update','archive','restore','route_set','route_removed',
  'pin_set','left','returned','reports_to_reassigned','password_change','password_reset',
  'branch_set','branch_removed'));
```

**Backfill in the same file (V5: same ULIDs).** For every active item that is stock-tracked at some branch under 01a's rule (route at a slot station and `stock_time_ms IS NOT NULL`, or at a batch station and `stock_program_id IS NOT NULL`; `item_routes` joined to `stations` for `station_type`): insert `stock_items (stock_item_id = item_id, name = item name, stock_unit = item.stock_unit, carries_over = item.carries_over)`; one `stock_item_branches` row per such route (`station_id` = the route's station, `low_stock_threshold` = the item's); one `stock_draws (item_id, stock_item_id = item_id, quantity_per_sale_unit = stock_per_sale_unit)`. Three `INSERT … SELECT` statements, no audit rows (a migration is not an owner write; 01a `0003` precedent). Items with a `group_label` are not converted into variant groups (no live data; `seed-demo` builds groups directly).

**Deprecated columns** (`menu_items.group_label`, `stock_unit`, `stock_per_sale_unit`, `low_stock_threshold`, `carries_over`): kept for expand/contract (F §6.8); the service writes `stock_unit = sale_unit`, `stock_per_sale_unit = 1`, the rest null/false on every item write so the 01a CHECKs hold; never read. Dropped by a later migration (§12.4).

### 5.2 Hub

No hub migration (v0.3, m9: the deal toggle and its projection are deferred, §12.4). Stock lives in `EngineState` (01a D50); a stored schema-1 `branch_config` body is treated as missing until the first schema-2 poll (01a S28 d).

### 5.3 Event upcasters (D46)

| From | To | Rule |
|---|---|---|
| `StockSet` v1 `{ item_id, on_hand, unit }` | v2 `{ stock_item_id, on_hand, unit }` | `stock_item_id = item_id` |
| `StockAdded` v1 `{ item_id, quantity, unit }` | v2 `{ stock_item_id, quantity, unit }` | `stock_item_id = item_id` |
| `BusinessDayOpened` v1 `{ business_date, units: { [item_id]: { stock_unit, sale_unit, stock_per_sale_unit } } }` | v2 `{ business_date, stock_units, draws }` | for each key k: `stock_units[k] = stock_unit`; `draws[k] = { sale_unit, stock_draws: [{ stock_item_id: k, quantity_per_sale_unit: stock_per_sale_unit }] }` |

Stream ids of stored v1 stock events are the item ids, equal to the stock item ids (V5). Fixtures: new `StockSet.v2.json`, `StockAdded.v2.json`, `BusinessDayOpened.v2.json`; the `.latest.json` files become v2; the `.v1.json` files are never edited (F §6.7).

### 5.4 Wire shapes and version inputs (`packages/events/src/admin/menu-variants.ts`; builder `apps/cloud/src/modules/menu-variants/versions.ts`)

Canonicalisation is 01b §5.3 rules 1–6 (hash `sha256hex(canonicalJson(input))`; exactly these keys; arrays sorted by the builder; nullable values `null`; `Number()` on every `BIGINT`; strings as stored). `archived` = `archived_at IS NOT NULL`.

| Entity | Version input (exactly these keys) | Array order |
|---|---|---|
| Variant group | `variant_group_id`, `name`, `category_id`, `description`, `sort_order`, `archived` | — |
| Stock item | `stock_item_id`, `name`, `stock_unit`, `carries_over`, `archived` | — |
| Stock item branch | `stock_item_id`, `branch_id`, `is_counted`, `station_id`, `low_stock_threshold` (no row → `is_counted: false`, both null) | — |
| Modifier group | `modifier_group_id`, `name`, `min_choices`, `max_choices`, `sort_order`, `archived`, `options` (active only: `option_id`, `name`, `price_minor`, `max_quantity`, `is_default`, `linked_item_id`, `sort_order`), `links` (`target_kind`, `target_id`, `mode`) | options by `sort_order`, then `option_id`; links by `target_kind`, then `target_id` |
| Modifier group at a branch (V19) | `modifier_group_id`, `branch_id`, `options` (the stored difference rows for the group's **active** options at that branch: `option_id`, `is_offered`, `price_minor_override`; no rows → `[]`) | options by `option_id` |
| Deal | `deal_id`, `name`, `category_id`, `tax_class_id`, `description`, `sort_order`, `price_minor`, `archived`, `availability_windows` (`start_ms`, `end_ms`), `parts` (active only: `deal_part_id`, `quantity`, `sort_order`, `choices`: `item_id`, `extra_price_minor`, `sort_order`) | windows by `start_ms`, `end_ms`; parts by `sort_order`, then `deal_part_id`; choices by `sort_order`, then `item_id` (m5) |
| Deal branch | `deal_id`, `branch_id`, `is_sold`, `price_minor_override` (no row → `is_sold: false`, null) | — |

Wires add `version` (not in audit rows) and, for groups and deals, `archived_options` / `archived_parts` (`{ option_id, name }` / `{ deal_part_id }`, for restore; not hashed). The modifier group wire adds `branches: [{ branch_id, options: [{ option_id, is_offered, price_minor_override }], version }]` for the owner's allowed branches (V19). The item wire adds `requires_weighing`.

---

## §6. Endpoints, commands and events

Owner routes: JWT, tenant guard, 00's password guard (01a §6 v1.3 note). Tenant-level writes (variant groups, stock items, modifier groups, deals, items) need an owner covering every branch (S8) and bump every branch; branch PUTs bump that branch. Every creating `POST` runs through `withIdempotency`. No cloud route emits an event. Check order per write (C4): (1) `400` schema incl. C6 keyed duplicates; auth and tenant-wide `403` before all; (2) `404` target; (3) `409 CONFIG_STALE` (versioned writes only); (4) payload-internal checks on the sent body (references C1, each sent field as on create); (5) no-op: a merged row equal to the stored one writes nothing, `200` with the stored entity (S26); (6) merged-row rules named per PATCH; then write, audit, bump. Shared failure cases not repeated: `400 VALIDATION_FAILED`, `401 JWT_INVALID`, `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`, `403 PASSWORD_CHANGE_REQUIRED`, `422 IDEMPOTENCY_KEY_MISMATCH` (creating POSTs), `503 SERVICE_UNAVAILABLE`.

**Plain id lists:** 01c's write bodies have no list of bare ids (every list is keyed objects, C6), so C1's "drop a repeated id" never applies; its `not_found` rule does.

**Lock order (v0.3 M3, M4; v0.4 N2, N3; extends 01a S8 for every route 01c adds or changes).** Every 01c write takes its row locks (`FOR UPDATE` or `FOR SHARE`) in this one order of entity kinds, ids ascending within a kind; a write skips the kinds it does not lock and never locks an earlier kind after a later one. 01a S8's "target first, references `FOR SHARE` in id order, branch rows last" is this order whenever the target's kind comes before its references, which holds for every write except §6.5 (its variant group comes before the item, M3).

| # | Kind | Locked by (mode) |
|---|---|---|
| 1 | `modifier_groups` | §6.12, §6.12a target (`FOR UPDATE`) |
| 2 | `deals` | §6.15, §6.16 target (`FOR UPDATE`) |
| 3 | `variant_groups` | §6.2 target (`FOR UPDATE`); §6.4, §6.5, §6.11, §6.12 reference (`FOR SHARE`) |
| 4 | `menu_items` | §6.5 target and §6.2 members (`FOR UPDATE`); §6.11, §6.12 linked and target items (§6.12: on a restore, also the stored active options' linked items, R6, v0.6 Q1), §6.14, §6.15 choice items (`FOR SHARE`) |
| 5 | `stock_items` | §6.8, §6.9 target (`FOR UPDATE`); §6.4, §6.5 draw (`FOR SHARE`) |
| 6 | `categories` | 01a archive target (`FOR UPDATE`); §6.1, §6.2, §6.4, §6.5, §6.11, §6.12, §6.14, §6.15 reference (`FOR SHARE`) |
| 7 | `tax_classes` | 01a archive target (`FOR UPDATE`); §6.4, §6.5, §6.14, §6.15 reference (`FOR SHARE`) |
| 8 | `stations`, then `batch_programs` | 01a archive target (`FOR UPDATE`); §6.9 station, item route references (`FOR SHARE`) |
| 9 | branch rows (`item_routes`, `stock_item_branches`, `modifier_option_branches`, `deal_branches`), by `branch_id` | the row written (the write's own row lock: insert, update or delete; S8 "branch rows last"); a branch PUT reads its stored row without a lock, because the parent `FOR UPDATE` already serialises it (v0.5, P3) |
| 10 | `branches` (config version bump, v0.5 P3) | every write, last: tenant-wide writes lock every branch `FOR UPDATE` in `branch_id` order, branch PUTs `UPDATE` their branch (`config-version.ts`); the C2 branch check is a plain read |

Checked per write (v0.5, P3: each script below states its locks in this order; every write ends with 10): §6.1 (6 → 10); §6.2 (3 → 4 members → 6 → 10: the members are locked before the category, v0.4); §6.4 (3 → 5 → 6 → 7 → 8 → 9 → 10; the new item row is unlocked until insert, the 01a route rows are inserted last); §6.5 (3 → 4 → 5 → 6 → 7 → 8 → 10, restart rule below; on restore the routes' stations and programs, 8); §6.7 (10 only: insert, no lock); §6.8 (5 → 10); §6.9 (5 → 8 on a set → 9 → 10); §6.11 (3 → 4 → 6 → 10; v0.4: variant groups before linked items); §6.12 (1 → 3 → 4 → 6 → 10); §6.12a (1 → 9 → 10); §6.14 (4 → 6 → 7 → 10); §6.15 (2 → 4 → 6 → 7 → 10); §6.16 (2 → 9 → 10); 01a category, tax class and station archives with the V16 in-use checks (one target lock → 10; in-use checks are plain reads). Merged-row rules that read other entities (R4, R6, R8, R10 of §6.5; R2 of §6.8) are plain reads after the target lock; they take no lock. Branch PUTs (§6.9, §6.12a, §6.16) lock their parent row `FOR UPDATE`, so two PUTs on a branch row that does not exist yet serialise (M4).

**§6.5 restart rule (v0.4, N2 decision; replaces AU-9).** §6.5 reads the item without a lock, locks the variant group(s) it saw (stored and merged non-null, in id order) `FOR SHARE`, then locks the item `FOR UPDATE`, which re-reads it. If the locked row's stored `variant_group_id` differs from the one read before the lock (null → non-null, non-null → null, or another group), the transaction **rolls back and restarts from the beginning**; at most 3 attempts, then `503 SERVICE_UNAVAILABLE`. The rule applies on the no-group path too (stored and merged null: no group lock, item lock, compare). An item lock is therefore never followed by a group lock.

#### 6.0 Permission, audit and bump per route

| § | Route | Permission | `config_audit` (entity / action) | Bumps |
|---|---|---|---|---|
| 6.1 | `POST /v1/admin/variant-groups` | owner covering every branch | `variant_group` / `create` | every branch |
| 6.2 | `PATCH /v1/admin/variant-groups/:id` | same | `variant_group` / `update`, `archive`, `restore`; + one `menu_item` / `update` per moved member (C5) | every branch |
| 6.4 | `POST /v1/admin/menu-items` (changed) | same | as 01a | every branch |
| 6.5 | `PATCH /v1/admin/menu-items/:id` (changed) | same | as 01a; `stock_draws` in `before` / `after` | every branch |
| 6.7 | `POST /v1/admin/stock-items` | same | `stock_item` / `create` | every branch |
| 6.8 | `PATCH /v1/admin/stock-items/:id` | same | `stock_item` / `update`, `archive`, `restore` | every branch |
| 6.9 | `PUT /v1/admin/stock-items/:id/branches/:branch_id` | owner, branch allowed | `stock_item_branch` / `branch_set` or `branch_removed` | that branch |
| 6.11 | `POST /v1/admin/modifier-groups` | owner covering every branch | `modifier_group` / `create` (options, links in `after`) | every branch |
| 6.12 | `PATCH /v1/admin/modifier-groups/:id` | same | `modifier_group` / `update`, `archive`, `restore` (V15) | every branch |
| 6.12a | `PUT /v1/admin/modifier-groups/:id/branches/:branch_id` | owner, branch allowed | `modifier_group` / `branch_set` (with `branch_id`; the difference list in `before` / `after`) | that branch |
| 6.14 | `POST /v1/admin/deals` | same | `deal` / `create` (parts, windows in `after`) | every branch |
| 6.15 | `PATCH /v1/admin/deals/:id` | same | `deal` / `update`, `archive`, `restore` (V15) | every branch |
| 6.16 | `PUT /v1/admin/deals/:id/branches/:branch_id` | owner, branch allowed | `deal_branch` / `branch_set` or `branch_removed` | that branch |

Every route above and the reads (§6.3, §6.6, §6.10, §6.13) add a case to `apps/cloud/test/helpers/route-cases.ts` (C7).

**Hub commands** (admin session, `POST /admin/commands/…`; each appends events, no `config_audit` row):

| § | Command | Permission and scope | Events |
|---|---|---|---|
| 6.18 | `SetPrecookedStock` | `manage-stock`; `my_stations` by the stock item's station | `StockSet` v2 per entry |
| 6.19 | `AddPrecookedStock` | same | `StockAdded` v2 or `StockSet` v2 per entry |
| 6.20 | `OpenBusinessDay` | `manage-stock` scope `branch` (01b D-6) | `BusinessDayOpened` v2 |

### Batch 1 — variant groups, items, menu read

#### 6.1 `POST /v1/admin/variant-groups` (Idempotency-Key)

| | |
|---|---|
| Body | `{ name, category_id, description?, sort_order? }` |
| Script | common write script; lock category `FOR SHARE`; insert; audit; bump every branch |
| Response | `201 { data: { variant_group: VariantGroupWire } }` (with `version`, `member_ids: []`) |
| Errors | `409 CONFIG_NAME_TAKEN { entity: 'variant_group' }`; `422 CONFIG_REFERENCE_INVALID { field: 'category_id', reason: 'not_found' \| 'archived' }` |
| Queries | fixed: key insert, category lock, insert, audit, 3 bump |

| Edge | Answer |
|---|---|
| Repeated ids (C1) / keyed duplicates (C6) | none in the body |
| Unknown or foreign-tenant `category_id` | `422 not_found` |
| Empty name | `400` |
| Retry with the same key | stored `201` replayed, `Idempotent-Replay: true` |
| Audit | one row |

#### 6.2 `PATCH /v1/admin/variant-groups/:variant_group_id`

| | |
|---|---|
| Body | `expected_version` (required) + any of `name`, `category_id`, `description`, `sort_order`, `archived` |
| Script | validate → `BEGIN` → lock group `FOR UPDATE` (`404 VARIANT_GROUP_NOT_FOUND`) → version compare (`409 CONFIG_STALE { entity: 'variant_group', id }`) → if `category_id` is sent and differs: lock the members (active and archived) `FOR UPDATE` in `item_id` order (M3; v0.4 N3: members before the category, §6 lock order) → payload checks (category reference `FOR SHARE`) → no-op → merged rules → write; if `category_id` changed: `UPDATE menu_items SET category_id … WHERE variant_group_id = $1 RETURNING *` (archived members move too, M6) → audit group + one `menu_item` / `update` per moved member (one multi-row insert) → bump every branch → `COMMIT` |
| Merged-row rules (C4 step 6) | **R1** `archived: true` with active members → `409 CONFIG_IN_USE { used_by: { entity: 'menu_item', ids } }`; **R2** name unique (index → `409`); **R3** a category change re-checks the effective-set limit for every member (`422 too_many_groups`, field `category_id`) |
| Response | `200 { data: { variant_group } }` (moved members are 01a items, which carry no version, V13) |
| Errors | `404 VARIANT_GROUP_NOT_FOUND`, `409 CONFIG_STALE`, `409 CONFIG_NAME_TAKEN`, `409 CONFIG_IN_USE`, `422 CONFIG_REFERENCE_INVALID` |
| Queries | fixed: lock, members lock, category share, update, members update, links + members read for R3, audit (1 multi-row), 3 bump |

| Edge | Answer |
|---|---|
| Body only `expected_version` | `400` (C9) |
| Stale version, also when the body would be a no-op | `409 CONFIG_STALE` |
| Unknown / foreign group | `404` |
| Unknown / archived category | `422 not_found` / `archived` |
| Archive then restore | `restore` row; members untouched (they were never archived by the group) |
| Cascade audit (C5) | one `menu_item` row per moved member, each with `branch_id` null |

#### 6.3 `GET /v1/admin/menu` (changed, 01a §6.11)

Adds `variant_groups` (whole, archived included, like `categories`) and per item `variant_group_id`, `variant_name`, `stock_draws`; removes `group_label`, `stock_unit`, `stock_per_sale_unit`, `low_stock_threshold`, `carries_over`. `q` matches item `name` or its group's `name`. **Queries: 8 fixed** (01a's 6 + variant groups + the page items' draws `= ANY($ids)`).

#### 6.4 `POST /v1/admin/menu-items` (changed, 01a §6.14)

Body adds `variant_group_id?` (default null), `variant_name?`, `stock_draws?: [{ stock_item_id, quantity_per_sale_unit }]` (0–1), `requires_weighing?` (default false, V18); the removed fields are dropped by the schema (01a schemas are not `.strict()`). Script adds, in the §6 lock order (v0.5, P3): the variant group `FOR SHARE` (3), then the stock item `FOR SHARE` (5), both before 01a's category, tax class and station references (6 → 7 → 8); the route rows are inserted last (9); check §3.3 rows (category match, variant name, draw unit rule, effective-set limit, weighed item rules); insert the draw row. Queries: 01a's fixed count + 2 reference reads + 1 draw insert + 1 links read (effective set).

| Edge | Answer |
|---|---|
| Two draws for one stock item (C6) | `400` path `stock_draws.1.stock_item_id`; a second draw at all → `400` (max 1) |
| Unknown / foreign / archived group or stock item | `422 not_found` / `archived` |
| `variant_name` without group, or group without name | `400` |
| Variant name taken in the group | `409 CONFIG_NAME_TAKEN { entity: 'variant' }` |
| Category ≠ group's | `422 category_mismatch` |
| `sale_unit 'g'`, stock item in `piece` | `422 unit_mismatch` (field `stock_draws.0.stock_item_id`) |
| `requires_weighing: true` with `sale_unit 'piece'` | `400` |
| `requires_weighing: true` with a stock draw | `422 weighed_item_stock_draw`, field `stock_draws` |
| Audit | one `menu_item` / `create` (+ 01a route rows); the draw is inside `after` |

#### 6.5 `PATCH /v1/admin/menu-items/:item_id` (changed, 01a §6.15)

Last write wins (S23, V13 divergence). Lock order (v0.3 M3; v0.4 N2, N3; §6 "Lock order"): read the item unlocked → lock the variant group(s) seen (stored and merged non-null) `FOR SHARE` in id order → lock the item `FOR UPDATE` (re-read) → if the locked stored `variant_group_id` differs from the unlocked read (null included), roll back and restart, at most 3 attempts, then `503 SERVICE_UNAVAILABLE` → stock item, category, tax class, stations `FOR SHARE` per the table. New fields as §6.4; `stock_draws` replaces the item's draws (delete + insert). **Merged-row rules named (C4 step 6):** **R1** category equals the group's (on a change of either, **and on restore**, v0.3 M6); **R1a (M6)** on restore of a member, its group is active (else `422 { field: 'variant_group_id', reason: 'archived' }`); **R2** draw unit rule on the merged `sale_unit` and draw (a `sale_unit` change alone re-checks it); **R3** effective-set limit when `category_id` or `variant_group_id` changes; **R4** `archived: true` with an active option of an active group (m15) linking the item or an active deal part offering it → `409 CONFIG_IN_USE` (V16); **R5** variant name unique on the merged row (index); **R6 (v0.2, D-3)** a `sale_unit` change while an active deal part offers the item, when that part's active choices would then not share one `sale_unit` → `409 CONFIG_IN_USE { entity: 'menu_item', id, used_by: { entity: 'deal', ids } }` (reads the item's active choices and their parts' other choices: one statement, `deal_part_choices_item`); **R7 (V18)** `requires_weighing` true on the merged row needs `sale_unit ∈ g, ml` (`400`) and no draw (`422 weighed_item_stock_draw`); **R8 (V18)** `requires_weighing` turned on while an active deal part offers the item → `422 { field: 'requires_weighing', reason: 'weighed_item_in_deal' }`; **R9 (v0.4, N8)** on restore (`archived: false` onto an archived item), the merged draw's stock item is active, read under its `FOR SHARE` lock (else `422 { field: 'stock_draws.0.stock_item_id', reason: 'archived' }`; §6.8 R2 counts only active drawers, so a stock item can be archived while its drawer is archived); **R10 (v0.5, P1)** a `sale_unit` change away from `piece`, or `requires_weighing` turned on, while an active option of an active group links the item → `409 CONFIG_IN_USE { entity: 'menu_item', id, used_by: { entity: 'modifier_group', ids } }` (01a S22 pattern; the same read as R4, a plain read after the item lock; §6.12 locks linked items `FOR SHARE`, so the item `FOR UPDATE` serialises the two; a linked option needs a `piece` item, §3.3, because its child line is billed and voided per piece, §3.4.4, §3.4.8). 01a's merged rules stay.

**Rule precedence (C4 step 6, v0.6 Q2).** When several merged-row rules fail, the response is the first in this order: (1) the `400` rules (01a's, and R7's `sale_unit ∈ g, ml` part); (2) the `409 CONFIG_IN_USE` rules in the order **R4, R10, R6** (modifier groups before deals, as R4 already reports); (3) the `422` rules in rule-number order (01a's first, then R1, R1a, R2, R3, R7's draw part, R8, R9); (4) R5 (the variant-name unique index) at the write. Step 4's reference checks on sent fields (C4) still come before all of step 6. **v1.0 (T4 decision, V13 divergence):** on `menu_items` the no-op step (5) runs before the reference checks (4), as 01a built it, and R1–R10 run after the no-op step in the order above.

| Edge | Answer |
|---|---|
| Leave a group | `{ variant_group_id: null, variant_name: null }`; sending one of them null alone → `400` |
| Stale tab | no version (S23); last write wins |
| No-op (same fields) | `200`, no audit, no bump (S26) |
| Archive used by deal | `409 CONFIG_IN_USE { used_by: { entity: 'deal', ids } }` (modifier groups reported first when both) |
| `sale_unit` `piece` → `g` on Naan, offered with Roghni naan (`piece`) in one deal part | `409 CONFIG_IN_USE { used_by: { entity: 'deal', ids } }` (R6) |
| `sale_unit` change on the only choice of a part | `200` (one choice always shares its unit; the part's quantity is now read in the new unit, owner's responsibility, shown on the deal form) |
| `requires_weighing: true` on an item with a draw, or offered by a deal | `422 weighed_item_stock_draw` / `weighed_item_in_deal` (R7, R8) |
| `sale_unit: 'piece'` sent alone onto a weighed item | `400` (R7) |
| Restore a member whose group is archived | `422 archived`, field `variant_group_id` (R1a, M6) |
| Restore an item whose draw's stock item is archived | `422 { field: 'stock_draws.0.stock_item_id', reason: 'archived' }`, nothing written (R9, N8) |
| `sale_unit` `piece` → `g`, or `requires_weighing: true`, on Naan linked by an active option of an active group | `409 CONFIG_IN_USE { entity: 'menu_item', id, used_by: { entity: 'modifier_group', ids } }`, nothing written (R10, P1) |
| The same change with the linking option archived, or its group archived | `200` (R10 counts active options of active groups only; restoring that group is then refused by §6.12 R6, v0.6 Q1) |
| Several merged rules fail at once (e.g. Naan linked by an active option **and** offered with Roghni in a deal part, `sale_unit: 'g'`) | the first by the rule precedence above: `409 CONFIG_IN_USE { used_by: { entity: 'modifier_group', ids } }` (R10 before R6) (v0.6 Q2, test 128) |
| Member PATCH concurrent with a §6.2 category move | serialised group → item (M3); no deadlock |
| The item joins or leaves a group between the unlocked read and the item lock (either path) | rolled back and restarted; the next attempt locks the new group first; after 3 attempts `503 SERVICE_UNAVAILABLE` (N2) |

### Batch 2 — stock items

#### 6.6 `GET /v1/admin/stock-items`

Query `status?` ∈ `active` (default), `archived`. Response `200 { data: { can_edit_tenant, stock_items: [{ …StockItemWire, branches: [{ branch_id, station_id, low_stock_threshold, version }], drawers: [{ item_id, name, variant_name, quantity_per_sale_unit }] }] } }`, ordered by `lower(name)`, then id (C3); `branches` only for `allowed_branch_ids`. Bounded (a tenant has tens), no pagination. **Queries: 4 fixed** (coversEveryBranch, stock items, branch rows `= ANY`, drawers joined to active items `= ANY`).

#### 6.7 `POST /v1/admin/stock-items` (Idempotency-Key)

Body `{ name, stock_unit, carries_over? }`. `201 { data: { stock_item } }`. Errors `409 CONFIG_NAME_TAKEN { entity: 'stock_item' }`. Queries: key, insert, audit, 3 bump.

| Edge | Answer |
|---|---|
| Repeated ids (C1) / keyed duplicates (C6) | none in the body |
| Unknown ids / foreign branch (C2) | none referenced (branch rows are §6.9) |
| Bad `stock_unit` | `400` |
| Empty lists | none |
| Retry with the same key | stored `201` replayed |
| Audit | one `stock_item` / `create` row, `branch_id` null |

#### 6.8 `PATCH /v1/admin/stock-items/:stock_item_id`

| | |
|---|---|
| Body | `expected_version` + any of `name`, `stock_unit`, `carries_over`, `archived` |
| Script (v0.5, P3) | validate → `BEGIN` → lock the stock item `FOR UPDATE` (`404 STOCK_ITEM_NOT_FOUND`) → version compare (`409 CONFIG_STALE`) → payload checks → no-op → merged rules (R1, R2 read the drawers without a lock) → write → audit → bump every branch → `COMMIT` |
| Merged-row rules | **R1** `stock_unit` change re-runs the draw unit rule (V4) on every active drawer → `422 { field: 'stock_unit', reason: 'unit_mismatch' }`; **R2** `archived: true` with an active drawer → `409 CONFIG_IN_USE { used_by: { entity: 'menu_item', ids } }`; **R3** name unique |
| Notes | A `stock_unit` change takes effect on each hub at its next day open (S44 frozen units); counts in the old unit stop being valid (S41) |
| Errors | `404 STOCK_ITEM_NOT_FOUND`, `409 CONFIG_STALE`, `409 CONFIG_NAME_TAKEN`, `409 CONFIG_IN_USE`, `422` |

| Edge | Answer |
|---|---|
| Body only `expected_version` | `400` (C9) |
| Unknown / foreign id | `404` |
| Cascade | none (branch rows and draws untouched); one audit row |

#### 6.9 `PUT /v1/admin/stock-items/:stock_item_id/branches/:branch_id`

| | |
|---|---|
| Body | `{ expected_version, station_id: string \| null, low_stock_threshold?: int \| null }`; `station_id: null` removes the row (not counted here; a threshold with it → `400`) |
| Script (C4 order, v0.2) | validate (`400`) → `BEGIN` → lock the stock item `FOR UPDATE` (`404 STOCK_ITEM_NOT_FOUND`; v0.3 M4: serialises two PUTs on a row that does not exist yet) → branch row read inside the transaction (C2: `404 BRANCH_NOT_FOUND`) → read the stored `stock_item_branches` row **without a lock** (v0.5, P3: the stock item `FOR UPDATE` already serialises every write to it) → version compare (`409 CONFIG_STALE`) → payload checks: on a set, the stock item is active (else `422 { field: 'stock_item_id', reason: 'archived' }`) and the station is an active station of this branch `FOR SHARE` (`422 not_found` / `archived` / `wrong_branch`) → no-op → upsert or delete (the row's lock is taken here, after the station: 5 → 8 → 9) → audit → bump that branch |
| Response | `200 { data: { branch: { branch_id, station_id, low_stock_threshold, version } \| null } }`. Idempotent; no `Idempotency-Key` (01a §6.16 precedent) |

| Edge | Answer |
|---|---|
| Foreign / unknown branch (C2) | `404 BRANCH_NOT_FOUND` (checked inside the transaction) |
| Station of another branch | `422 wrong_branch` |
| Remove a row that does not exist | no-op `200 { branch: null }` (with the matching "no row" version) |
| Stale | `409 CONFIG_STALE { entity: 'stock_item_branch', id: stock_item_id }` |
| Two first-time PUTs from tabs that both loaded "no row" | one `200`, one `409 CONFIG_STALE` (M4) |
| Audit | one row, `branch_id` set |

### Batch 3 — modifier groups

#### 6.10 `GET /v1/admin/modifier-groups`

`status?` as §6.6. `200 { data: { can_edit_tenant, modifier_groups: [ModifierGroupWire] } }` with `options` (active), `archived_options`, `links`, `branches` (allowed branches, V19), `version`; ordered by `sort_order`, then id. **Queries: 5 fixed** (coversEveryBranch, groups, options `= ANY`, links `= ANY`, branch rows for the allowed branches `= ANY`).

#### 6.11 `POST /v1/admin/modifier-groups` (Idempotency-Key)

| | |
|---|---|
| Body | `{ name, min_choices, max_choices, sort_order?, options: [{ name, price_minor?, max_quantity?, is_default?, linked_item_id?, sort_order? }] (1–50, no ids), links?: [{ target_kind, target_id, mode }] (0–500) }` |
| Script | common write script; reference reads `FOR SHARE` per kind in the §6 lock order (v0.4, N3): variant groups, then items (linked items and target items in one `= ANY`, `item_id` order), then categories; merged group rules (§3.3); effective-set limit for the affected items; insert group, options (multi-row), links (multi-row); audit; bump every branch |
| Response | `201 { data: { modifier_group } }` |
| Errors | `409 CONFIG_NAME_TAKEN { entity: 'modifier_group' \| 'modifier_option' }`; `422 CONFIG_REFERENCE_INVALID` |
| Queries | fixed: key, ≤ 4 reference reads, 1 effective-set read (links + items of the targets), 3 inserts, audit, 3 bump |

| Edge | Answer |
|---|---|
| Option with an `option_id` on POST | `400` (POST options carry no ids) |
| Two links for one target (C6) | `400` path `links.N.target_id` (N = the repeat) |
| Two options with one name | `409 CONFIG_NAME_TAKEN { entity: 'modifier_option', name }` (checked in the service before insert) |
| Unknown / foreign linked item or target | `422 not_found`, field `options.N.linked_item_id` / `links.N.target_id` |
| Linked item sold by weight | `422 linked_item_not_piece` |
| Empty `options` | `400` |
| `detach` on a category | `400` |
| Audit | one row, options and links in `after` (V15) |

#### 6.12 `PATCH /v1/admin/modifier-groups/:modifier_group_id`

| | |
|---|---|
| Body | `expected_version` + any of `name`, `min_choices`, `max_choices`, `sort_order`, `archived`, `options` (whole, entries may carry `option_id`), `links` (whole) |
| Script | validate → `BEGIN` → lock group `FOR UPDATE` (`404 MODIFIER_GROUP_NOT_FOUND`) → version → payload checks: each sent `option_id` is an option of **this** group, active or archived (else `422 not_found`, field `options.N.option_id`); references `FOR SHARE` in the §6 lock order (variant groups, then linked and target items, then categories; v0.4, N3; links: only added or changed entries are re-checked against active targets, m15; when the merged group is active and `options` is not sent, as on a restore, the stored active options' linked items join the items' `= ANY` lock for R6, v0.6 Q1) → no-op → merged rules → rewrite options (V14) and/or links (delete + multi-row insert) → audit → bump |
| Merged-row rules | **R1** `min_choices ≤ max_choices` on the merged row (`400`); **R2** `choices_unsatisfiable` on merged min and merged options; **R3** `defaults_exceed_max` on merged max and options; **R4** option names unique among merged active options (`409`; one SQL statement over `lower(name)` under the group lock, m13); **R5** effective-set limit when `links` is sent; **R6 (v0.6, Q1)** whenever the merged group is active and the PATCH restores it or sends `options`: every active option's linked item is active, `sale_unit = 'piece'` and not `requires_weighing`, read under the linked items' `FOR SHARE` (kind 4) → `422 { field: 'options.N.linked_item_id', reason: 'linked_item_not_piece' \| 'archived' }` (N = the option's index in the sent list, or on a restore in the stored active options by `sort_order`, then `option_id`); this closes the restore path that §6.5 R10 leaves open by counting only active groups |
| Errors | `404`, `409 CONFIG_STALE`, `409 CONFIG_NAME_TAKEN`, `422 CONFIG_REFERENCE_INVALID` |

| Edge | Answer |
|---|---|
| Repeated `option_id` in `options` (C6) | `400` path `options.N.option_id` |
| An option id of another group / tenant | `422 not_found` (never created) |
| An archived option's own id | restored, same ULID |
| Omitted active option | archived |
| `options: []` | `400` (1–50) |
| Body only `expected_version` | `400` (C9) |
| Archive the group | allowed; links stay but the builder ignores an archived group; no in-use check (open orders hold copies) |
| Restore a group (`archived: false`) whose linked item became `g` or weighed while it was archived | `422 { field: 'options.N.linked_item_id', reason: 'linked_item_not_piece' }`, nothing written (R6, v0.6 Q1) |
| Restore a group whose linked item was archived meanwhile | `422 { field: 'options.N.linked_item_id', reason: 'archived' }` (R6) |
| Archive an option that has branch rows | the rows stay and are ignored (V19 version input covers active options only); restoring the option brings them back |
| Audit | one row, whole active lists before / after |

#### 6.12a `PUT /v1/admin/modifier-groups/:modifier_group_id/branches/:branch_id` (v0.2, V19)

| | |
|---|---|
| Body | `{ expected_version, options: [{ option_id, is_offered: boolean, price_minor_override?: int \| null }] }`: the **whole** list of this group's differences at this branch (0–50) |
| Script (C4 order) | validate (`400`: schema, `is_offered: false` with an override, keyed duplicate `option_id`) → `BEGIN` → lock the group `FOR UPDATE` (`404 MODIFIER_GROUP_NOT_FOUND`; the lock serialises with §6.12 and with other branch PUTs on the group) → branch row read inside the transaction (C2: `404 BRANCH_NOT_FOUND`) → read the group's stored rows at this branch → version compare (`409 CONFIG_STALE { entity: 'modifier_group_branch', id: modifier_group_id }`) → payload checks: the group is active (else `422 { field: 'modifier_group_id', reason: 'archived' }`); each `option_id` is an **active option of this group** (else `422 { field: 'options.N.option_id', reason: 'not_found' }`) → normalise: entries equal to the default (`is_offered: true`, no override) are dropped → no-op (normalised list equals the stored rows) → `DELETE` the rows of the group's **active** options at this branch (rows of archived options stay, v0.3 m4) + one multi-row `INSERT` → audit `modifier_group` / `branch_set` with `branch_id`, `before` / `after` = the difference lists → bump that branch → `COMMIT` |
| Response | `200 { data: { branch: { branch_id, options: [...], version } } }`; idempotent (PUT), no `Idempotency-Key` |
| Errors | `404 MODIFIER_GROUP_NOT_FOUND`, `404 BRANCH_NOT_FOUND`, `409 CONFIG_STALE`, `422 CONFIG_REFERENCE_INVALID` |
| Queries | fixed: group lock, branch read, stored rows, options check (`= ANY`), delete, insert, audit, bump (lock, update) |

| Edge | Answer |
|---|---|
| Repeated ids (C1) | none: `options` is a keyed list |
| Keyed duplicate `option_id` (C6) | `400` path `options.N.option_id`, N the repeat |
| Option of another group, of another tenant, unknown or archived | `422 not_found` (never created) |
| Foreign / unknown branch (C2) | `404 BRANCH_NOT_FOUND`, inside the transaction after the owner checks |
| `options: []` | valid: every option back to its default at this branch (rows deleted); audited unless already empty (no-op) |
| `is_offered: false` with an override | `400` |
| Same list again | no-op `200`, no audit, no bump (S26) |
| Stale | `409 CONFIG_STALE` |
| Merged-row rules (C4 step 6) | none on the group itself; a required group left with no offered option at the branch is **allowed** (F1: the builder keeps it with `options: []` and the items are not orderable there; the owner page warns) |
| Audit (C5) | one row; no cascade |

### Batch 4 — deals

#### 6.13 `GET /v1/admin/deals`

`200 { data: { can_edit_tenant, deals: [DealWire] } }` with `parts` (active, with `choices`), `archived_parts`, `availability_windows`, `branches: [{ branch_id, price_minor_override, version }]` (allowed branches only), `version`; ordered by `sort_order`, then id. **Queries: 5 fixed** (coversEveryBranch, deals, parts with choices joined, windows `= ANY`, branch rows `= ANY`).

#### 6.14 `POST /v1/admin/deals` (Idempotency-Key)

| | |
|---|---|
| Body | `{ name, category_id, tax_class_id: string \| null, description?, sort_order?, price_minor, availability_windows?, parts: [{ quantity, sort_order?, choices: [{ item_id, extra_price_minor?, sort_order? }] }] }` |
| Script | common write script; references `FOR SHARE` in the §6 lock order (choice items `= ANY`, then category, then tax class; v0.4, N3); §3.3 deal rules; insert deal, parts (multi-row), choices (multi-row), windows (multi-row); audit; bump |
| Response | `201 { data: { deal } }` (sold at no branch until §6.16) |

| Edge | Answer |
|---|---|
| Part with a `deal_part_id` on POST | `400` |
| One item twice in a part's choices (C6) | `400` path `parts.N.choices.M.item_id` |
| The same item in two parts | allowed (2 parts of naan is valid) |
| Unknown / archived choice item | `422 not_found` / `archived`, field `parts.N.choices.M.item_id` |
| Mixed sale units in a part | `422 choice_unit_mismatch`, field `parts.N.choices` |
| A weighed choice item (V18) | `422 weighed_item_in_deal`, field `parts.N.choices.M.item_id` |
| Single choice with an extra | `400` |
| `parts: []` | `400` |
| Audit | one row (parts, choices, windows in `after`) |

#### 6.15 `PATCH /v1/admin/deals/:deal_id`

| | |
|---|---|
| Body | `expected_version` + any of the §6.14 fields (each list whole; parts may carry `deal_part_id`) and `archived` |
| Script (v0.5, P3) | validate → `BEGIN` → lock the deal `FOR UPDATE` (`404 DEAL_NOT_FOUND`) → version compare (`409 CONFIG_STALE`) → payload checks with references `FOR SHARE` in the §6 lock order: the choice items of the merged parts (`= ANY`, `item_id` order), then the category, then the tax class (each when sent, R4) → no-op → merged rules → upsert parts, rewrite the sent parts' choices, windows → audit → bump every branch → `COMMIT` |
| Merged-row rules | **R1** name unique; **R2** each part's choices share `sale_unit`, re-run on the merged parts with the choice items' current `sale_unit` (the item side is §6.5 R6, D-3); **R3** single-choice parts have extra 0; **R4** category and tax class references re-checked only when sent (unsent fields trusted, C4); **R5 (V18)** no choice item is weighed (`422 weighed_item_in_deal`), re-run on the merged parts |
| Notes | `deal_part_id` rules as V14; parts upserted (an archived part keeps its row), choices of the sent parts rewritten (v0.3, m3) |
| Errors | `404 DEAL_NOT_FOUND`, `409 CONFIG_STALE`, `409 CONFIG_NAME_TAKEN`, `422` |

| Edge | Answer |
|---|---|
| Repeated `deal_part_id` (C6) | `400` |
| Part id of another deal | `422 not_found` |
| Omitted part | archived; restored by its id |
| Body only `expected_version` | `400` (C9) |
| Audit | one row |

#### 6.16 `PUT /v1/admin/deals/:deal_id/branches/:branch_id`

Body `{ expected_version, is_sold: boolean, price_minor_override?: int \| null }`. Script: validate → `BEGIN` → lock the deal `FOR UPDATE` (v0.3 M4, `404 DEAL_NOT_FOUND`) → C2 branch read inside the transaction → read the stored `deal_branches` row without a lock (the deal lock serialises it, v0.5 P3) → version → on `is_sold: true`, an archived deal → `422 archived` → no-op → upsert or delete (row lock here: 2 → 9) → audit → bump that branch → `COMMIT`; responses as §6.9. Audit `deal_branch` / `branch_set` or `branch_removed`; bump that branch. Response `200 { data: { branch: { branch_id, price_minor_override, version } \| null } }`.

| Edge | Answer |
|---|---|
| Repeated ids (C1) / keyed duplicates (C6) | none in the body |
| Unknown / foreign deal | `404 DEAL_NOT_FOUND` |
| Foreign / unknown branch (C2) | `404 BRANCH_NOT_FOUND`, inside the transaction after the owner checks |
| `is_sold: false` with an override | `400` |
| `is_sold: false` on a branch with no row | no-op `200 { branch: null }`, no audit, no bump |
| Stale | `409 CONFIG_STALE { entity: 'deal_branch', id: deal_id }` |
| Two first-time PUTs | one `200`, one `409 CONFIG_STALE` (M4) |
| Same values again | no-op `200` (S26) |
| Audit | one row with `branch_id` |

### Batch 5 — delivery and hub

#### 6.17 `GET /v1/sync/config` (changed, 01a §6.1) and `GET /queries/branch-config` (01a §6.23)

Serve snapshot 2 (§4.6). Builder statements stay fixed: 01a's + variant groups, stock items with this branch's rows, draws, modifier groups with options, this branch's option rows (V19), links, deals with parts and choices, deal windows, deal branch rows (9 more `= ANY` / branch-scoped reads; the effective-set resolution and the F1 rule run in memory). The hub rejects a body whose `snapshot_schema_version` ≠ 2 (01a S28 b).

#### 6.18 `POST /admin/commands/set-precooked-stock` — `SetPrecookedStock` (changed, 01a §6.17)

Payload `{ entries: [{ stock_item_id, on_hand }] }` (1–200, unique `stock_item_id` → `400` path `entries.N.stock_item_id`, C6). Each entry: a stock item in `branchConfig().stock_items` (else `404 STOCK_ITEM_NOT_FOUND { stock_item_id }`); scope `my_stations`: the stock item's `station_id` ∈ `stationsOf(staff, 'count_stock')` (else `403 outside_scope { stock_item_ids }`, after the 404/409 checks, C8). One `StockSet` v2 per entry, `unit = dayStockUnit(state, stockItem)`. Result `{ stock_items: [{ stock_item_id, on_hand, reserved, unit, available, level, set_at }] }`. Otherwise as 01a (business day open, idempotency, COMMIT-failure test).

| Edge (§6.18) | Answer |
|---|---|
| Repeated `stock_item_id` (C6) | `400` path `entries.N.stock_item_id`, N the repeat |
| Unknown stock item, or one not counted at this branch | `404 STOCK_ITEM_NOT_FOUND` for the first such entry; nothing written for any entry |
| Foreign branch (C2) | not applicable: the hub serves one branch; a stock item of another branch is not in its config → `404` |
| Empty `entries` | `400` (1–200) |
| No business day open | `409 BUSINESS_DAY_NOT_OPEN` |
| Scope `my_stations` with one entry outside | `403 outside_scope` listing every outside id in request order, after the 404/409 checks (C8) |
| Retransmit | stored response, no new events (D32) |

#### 6.19 `POST /admin/commands/add-precooked-stock` — `AddPrecookedStock` (changed, 01a §6.17a)

As §6.18 with `quantity`; `StockAdded` v2 when the count is valid, else `StockSet` v2 (S45). Edge cases as the §6.18 table, with `quantity` 1 … 1 000 000.

#### 6.20 `POST /admin/commands/open-business-day` — `OpenBusinessDay` (changed, 01a §6.18a)

Appends `BusinessDayOpened` v2 with `stock_units` for every stock item in the config and `draws` for every tracked item. Rules otherwise 01a S33.

| Edge | Answer |
|---|---|
| Lists / ids | payload `{}`: none |
| No stock items in the config | `stock_units: {}`, `draws: {}`; the day still opens |
| A day already open | no-op `changed: false`, `reason: 'already_open'` (01a S33) |
| Scope `my_stations` | `403 outside_scope { required_scope: 'branch' }` (01b D-6) |
| Retransmit | replay |

#### 6.21 `GET /admin/queries/stock` (changed, 01a §6.19)

`stock_items_meta` (when `meta_version` differs): `[{ stock_item_id, name, stock_unit (day), carries_over, station_id, low_stock_threshold, has_tracked_drawers, drawers: [{ item_id, name, variant_name, sale_unit, quantity_per_sale_unit (day) }] }]`; **`has_tracked_drawers`** (v0.2, F4) is false when no item in this branch's config tracks a draw from the stock item (counted here, but nothing sold here uses it: no route, no stock time, or no stock program); the page marks the row "Not used by any dish here" and still allows counts; `stock` (numbers): `[{ stock_item_id, on_hand, reserved, unit, available, level, set_at }]`; `items_meta` / `items` keep the availability rows per menu item (no unit fields; `stock_item_ids`). No deal rows (v0.3, m9). Scope `my_stations`: stock rows whose stock item station is one of the person's; item rows as 01b B20. **Statements:** as 01a: `unchanged` 0; otherwise 1 (`item_availability`) when the numbers are sent.

#### 6.22 (removed in v0.3, m9)

`SetDealAvailability` is deferred (§12.4); the section number is not reused.

### 6.23 Endpoint count

01c's own routes (the budget): 6.1, 6.2, 6.6–6.16, 6.12a = **14** (budget 10–25; split above 30; 6.22 removed in v0.3, m9). 01a routes changed by 01c: 6.3, 6.4, 6.5, 6.17, 6.18, 6.19, 6.20, 6.21 = 8. **22** touched in total, still inside the split limit.

---

## §7. Cross-cutting (this module only)

| Item | Decision | YAGNI justification |
|---|---|---|
| Rate limits | None new (01a §7.4 applies) | Owner config writes, a handful a day |
| Logging | Version mismatches logged at `info` with `entity`, `id` (no bodies) | Diagnoses a looping `409` from a stale tab |
| Performance | Snapshot build stays fixed-statement; effective sets computed in memory over ≤ 500 links × ≤ 300 items per tenant | One build per config write, three branches |
| Release (V1) | One coordinated release: cloud migration `0006` → cloud app → every hub (schema 2; no hub migration) outside service hours (01a §7.8); a hub on schema 1 shows the danger banner until upgraded (S28 b) | No hub runs real orders before 2027-02-28 |
| Folder placement | `apps/cloud/src/modules/menu-variants/` (F §6.9 `modules/<module>`); hub files in the existing folders; `packages/domain/src/menu-lines.ts` | — |
| Seed | `cli/seed-demo.ts` builds Chicken Karahi Half/Full on one Karahi pot, Spice level, Bread (linked Naan), Family karahi deal | Pages and E2E need realistic data |

---

## §8. Client contract (owner app `apps/client`, entry `owner`, S35; hub page `/admin/stock`)

- **Views:** item form gains a **Variant** section (group picker, variant name), a **Stock** section (stock item picker, "uses per sale" in the stock item's unit through `parseQuantity` / `formatQuantity`, and **Create a stock item with this name** (v0.3, m7): the client calls §6.7 POST, then §6.9 PUT for each branch where the item is routed (station = the route's), then the item PATCH with `stock_draws`; no new endpoint; if a call fails part-way, the created stock item stays (listed on the Stock items page) and the form retries the remaining calls. **Retries (v0.4, N9):** the form generates the POST's `Idempotency-Key` once and reuses it on every retry of that POST (a retry after a lost response replays the stored `201`); before retrying any remaining call it re-reads §6.6 (the stock item, its branch rows and each branch `version`) and sends only the calls still needed, each §6.9 PUT with the version just read, so a PUT that had already succeeded is skipped instead of answering `409 CONFIG_STALE`) and a **"Weighed when served"** switch (`requires_weighing`, shown only for kg / L items; turning it on hides the Stock section, V18); new views **Variant groups**, **Stock items** (with per-branch "Counted here at station …, alert below …" rows), **Modifier groups** (options table, "Applies to" with attach / opt-out per target, and a per-branch tab "Offered here / Price here" per option sending §6.12a; a warning when a required group has no option offered at a branch, F1), **Deals** (parts with choices, per-branch "Sold here / Price here").
- **Omitted at a branch (v0.3, m11):** the Deals page shows "Not sold at X: part N has no routed choice" for a deal sold at X whose part has no choice routed there, and the Modifier groups page shows "Not offered at X: its item is not sold there" for a linked option whose item has no route at X. Computed in the owner app from the `GET` responses (§6.10, §6.13, and the `routes` of the choice and linked items from the §6.3 menu pages the page loads for its item pickers); no new endpoint. **Shown only after the last menu page has loaded** (v0.4, N9: `next_cursor: null`); until then the page shows "Checking branches…" and no warning, so a partial load never hides an omission.
- **Versions:** every versioned form keeps the `version` it loaded and sends it; on `409 CONFIG_STALE` the form shows "Changed elsewhere — reload" and keeps the user's draft for copy; it never retries blind.
- **Ids:** forms send `option_id` / `deal_part_id` for existing rows and none for new ones; "Removed" rows are listed under the form with **Restore** (sends the archived id).
- **Read-only:** `can_edit_tenant: false` opens the tenant-level views read-only (01a §8.1 rule); branch rows stay editable for allowed branches.
- **Errors:** `422` `field` paths map to the row as sent (`options.N…`, `parts.N.choices.M…`).
- **Stock page (hub):** one row per stock item (count, add, level), drawers listed under it; availability toggles per item (no deal toggle, v0.3 m9).
- **i18n:** new keys in `en.ts` and `ur.ts` for every label and `errors.CONFIG_REFERENCE_INVALID.<reason>` for the new reasons.

---

## §9. Error catalogue additions

Appended to F §6.2 (status map) and `@pos/domain/src/errors.ts` in the same change.

| Code | Status | `details` | Returned when |
|---|---|---|---|
| `VARIANT_GROUP_NOT_FOUND` | 404 | `{ variant_group_id }` | PATCH on an unknown or foreign variant group |
| `STOCK_ITEM_NOT_FOUND` | 404 | `{ stock_item_id }` | Cloud PATCH/PUT on an unknown or foreign stock item; hub stock command for a stock item not in this branch's config |
| `MODIFIER_GROUP_NOT_FOUND` | 404 | `{ modifier_group_id }` | PATCH on an unknown or foreign group |
| `DEAL_NOT_FOUND` | 404 | `{ deal_id }` | Cloud PATCH/PUT on an unknown or foreign deal |

**`CONFIG_REFERENCE_INVALID.reason` adds** (C3; 01a §9 change A15): `category_mismatch`, `unit_mismatch`, `linked_item_not_piece`, `choices_unsatisfiable`, `defaults_exceed_max`, `too_many_groups`, `choice_unit_mismatch`, `weighed_item_in_deal`, `weighed_item_stock_draw` (V18). **`CONFIG_NAME_TAKEN.entity`** adds `variant_group`, `variant`, `stock_item`, `modifier_group`, `modifier_option`, `deal`. **`CONFIG_STALE.entity`** adds `variant_group`, `stock_item`, `stock_item_branch`, `modifier_group`, `modifier_group_branch`, `deal`, `deal_branch`. **`CONFIG_IN_USE`** reused (V16, §6.5 R6, R10): `entity` adds `variant_group`, `stock_item`, `menu_item` (01a used it for archive of categories, tax classes, stations, programs); `used_by.entity` adds `menu_item` (members of a variant group, drawers of a stock item), `modifier_group` (an option links the item: archive, V16; unit or weighing change, §6.5 R10), `deal` (a part offers the item, or uses the category or tax class), `variant_group` (uses the category), `stock_item` (counted at the station). `STOCK_NOT_TRACKED` stays in the catalogue and is no longer returned.

---

## §10. Tests

Test names cite `[01c #N]`. Cloud integration tests in `apps/cloud/test/menu-variants/`; hub in `apps/hub/test/`; units next to the source.

### 10.1 Pure functions (`packages/domain/src/menu-lines.test.ts`)

| # | Rule | Case |
|---|---|---|
| 1 | §3.4.2 | `childQuantity(3, 2, 'piece')` = 6 (piece parent × 2) |
| 2 | §3.4.2 | `childQuantity(3, 1250, 'g')` = 3 (weighted parent) |
| 3 | §3.4.3 | `optionChargeMinor(8000, 1, 2, 'piece')` = 16 000 |
| 4 | §3.4.3 | `optionChargeMinor(8000, 1, 1250, 'g')` = 8 000 (once per line) |
| 5 | V11 c | `allocateDealMinor(1000, [600, 400])` = `[600, 400]` (exact) |
| 6 | V11 c | `allocateDealMinor(1000, [1, 1, 1])` = `[333, 333, 334]` (remainder to last); sum always equals total (property test over 1 000 random cases) |
| 7 | V11 c | `allocateDealMinor(1000, [0, 500])` = `[0, 1000]`; `[0, 0]` = `[500, 500]`; `[0, 0, 0]` of 1000 = `[333, 333, 334]` |
| 8 | V11 c (M9), §4.3 | Family karahi deal; the naan part's choices are plain Naan Rs 30 (`sort_order` 1, reference) and Roghni Rs 60 (6 000, +3 000): allocation `[229315, 12508, 78177]` whichever naan is chosen; with Roghni ×4 the naan part's `allocated_price_minor` = 12 508 + 12 000 = 24 508 |
| 9 | §3.4.4 | `orderLineTotalMinor`: 1.25 kg karahi at 220 000/kg + Extra raita 8 000 = 275 000 + 8 000; 2 × Half (115 000) + raita = 230 000 + 16 000 |
| 10 | §3.4.4 | Deal ×2 with a piece part extra 3 000 × part qty 4 → deal line = 640 000 + 24 000 |
| 11 | §3.4.6 | `checkOptionChoices`: Spice level min 1 with none → violation; 2 picks of max 1 → violation; quantity > `max_quantity` → violation; option of a non-effective group → violation |
| 12 | V9 | `checkOptionChoices(…, 'child')` with a linked option → violation; A → B (B has linked option to A) offered as child → B's linked option not offered; A → B → A cannot be built |
| 13 | §4.4 02 | `isGroupSatisfiable(group, 'line')`: min 2 with one option of `max_quantity` 1 at the branch → false |
| 14 | V11 d | `isDealOrderable`: one fixed part off → false; pick-one with one choice off and one on → true; all choices off → false; outside windows → false |

### 10.2 Cloud — variant groups and items

| # | Rule | Case |
|---|---|---|
| 15 | §6.1 | Create group → `201`, audit row, every branch bumped; replay with the same key → stored response |
| 16 | §6.1 | Unknown, foreign-tenant and archived `category_id` → `422 not_found` / `not_found` / `archived` |
| 17 | §6.2 R1 | Archive a group with an active member → `409 CONFIG_IN_USE` listing the member |
| 18 | §6.2, C5 | Move a group with 2 members to another category → 3 audit rows (group + 2 `menu_item`), members' `category_id` changed |
| 19 | §6.2, V13 | Stale `expected_version` → `409 CONFIG_STALE`, nothing written; also when the body is a no-op |
| 20 | §6.2, C9 | Body only `expected_version` → `400` |
| 21 | §6.4, E0-MENU AC4 | Item Half (Rs 1,150, 20 min, station Karahi) and Full (Rs 2,200, 25 min, routed to station Grill) in one group with draws 500 g / 1 000 g on one Karahi pot → both in the snapshot with their own `price_minor`, `cook_time_ms`, `station_id`, plus `variant_group_id`, `variant_name`, `stock_draws` |
| 22 | §6.4 | Variant name taken in the group → `409 { entity: 'variant' }`; category ≠ group's → `422 category_mismatch`; name without group → `400` |
| 23 | §6.4, V4 | `sale_unit 'g'` + stock item `piece` → `422 unit_mismatch`; two draws → `400` path `stock_draws.1…` |
| 24 | §6.5 R2 | PATCH `sale_unit` alone onto an item drawing from a `g` stock item with factor 500 → re-checked: `piece` OK, `ml` → `422 unit_mismatch` |
| 25 | §6.5 R4, V16 | Archive an item linked by an active option → `409 CONFIG_IN_USE { used_by: { entity: 'modifier_group' } }`; by a deal choice → `{ entity: 'deal' }` |
| 26 | §6.3 | Menu read: `variant_groups` whole; `q='Karahi'` matches a member through its group name; 8 statements (counter) |
| 27 | §5.1 backfill | Migration on a seeded 01a tenant: each stock-tracked item gets a stock item with the same id, branch rows at its stations, one draw with its old factor; an untracked item gets none |

### 10.3 Cloud — stock items

| # | Rule | Case |
|---|---|---|
| 28 | §6.7 | Create Karahi pot (g) → `201`; duplicate active name → `409 { entity: 'stock_item' }` |
| 29 | §6.8 R1 | Change `stock_unit` to `ml` while an item draws with `sale_unit 'piece'` → OK; while an item draws with `sale_unit 'g'` → `422 unit_mismatch` |
| 30 | §6.8 R2 | Archive with an active drawer → `409 CONFIG_IN_USE` |
| 31 | §6.9 | PUT counted at Gulberg, station Karahi → row, audit `branch_set` with `branch_id`, only Gulberg bumped |
| 32 | §6.9, C2 | PUT for a branch outside `allowed_branch_ids` / another tenant's → `404 BRANCH_NOT_FOUND`; station of another branch → `422 wrong_branch` |
| 33 | §6.9 | `{ station_id: null }` removes (audit `branch_removed`); removing a missing row → `200 { branch: null }`, no audit, no bump |
| 34 | V16 | Archive station Karahi with a counted stock item → `409 CONFIG_IN_USE { used_by: { entity: 'stock_item' } }` |
| 35 | §6.6 | List: 4 statements; branch rows only for allowed branches; drawers listed |

### 10.4 Cloud — modifier groups

| # | Rule | Case |
|---|---|---|
| 36 | §6.11, E0-MENU edge | Create Spice level (min 1 max 1, Normal default) attached to category Karahi → every Karahi item has it in `modifier_group_ids`; a group "Extras" with "Extra napkins" at `price_minor` 0 → `201` and in the snapshot at 0 (zero-price add-on valid) |
| 37 | V8 | Detach on the Half item → Half lacks it, Full keeps it; detach on the variant group + attach on Full → only Full has it |
| 38 | §6.11, C6 | Two links for one target → `400` path `links.1.target_id`; detach on a category → `400` |
| 39 | §6.11 | Linked option to a `g` item → `422 linked_item_not_piece`; to an unknown item → `422 not_found` field `options.0.linked_item_id` |
| 40 | §3.3 | min 3 with options summing `max_quantity` 2 → `422 choices_unsatisfiable`; 2 defaults with max 1 → `422 defaults_exceed_max` |
| 41 | §3.3 | 21st effective group on an item → `422 too_many_groups` on the group write; and on an item PATCH that moves it to a category carrying the extra group |
| 42 | §6.12, V14 | PATCH keeps O1 (renamed), omits O2, adds O3 → O1 same id, O2 archived, O3 new ULID; second PATCH sends O2's id → restored, same id |
| 43 | §6.12, V14 | Swap names of O1 and O2 in one PATCH → `200` (rewrite, no unique-index failure) |
| 44 | §6.12, C1 | Option id from another group → `422 not_found`; from another tenant → `422 not_found`; nothing created |
| 45 | §6.12, C6 | Repeated `option_id` → `400` path `options.1.option_id` |
| 46 | §6.12, V13 | Tab A adds O3; tab B (stale) saves without O3 → `409 CONFIG_STALE`; O3 still active |
| 47 | V15 | Any group write → exactly one audit row with whole lists; no per-option rows |
| 48 | §6.12 R2 | PATCH `min_choices` alone above the merged options' capacity → `422` |

### 10.5 Cloud — deals

| # | Rule | Case |
|---|---|---|
| 49 | §6.14 | Family karahi deal with 3 parts → `201`; not in any snapshot until §6.16 |
| 50 | §6.14, C6 | One item twice in a part's choices → `400` path `parts.0.choices.1.item_id`; the same item in two parts → `201` |
| 51 | §6.14 | Choices with different `sale_unit` → `422 choice_unit_mismatch`; one choice with an extra → `400` |
| 52 | §6.15, V14 | Part ids kept / archived / restored as #42 |
| 53 | §6.15 | Part id of another deal → `422 not_found`; stale → `409`; body only version → `400` |
| 54 | §6.16 | Sold at Gulberg with override 300 000 → Gulberg snapshot price 300 000; other branches lack the deal |
| 55 | V11 e | Part whose only choice is not routed at Gulberg → deal absent from Gulberg's snapshot; a pick-one with one routed choice → present with that choice only |
| 56 | V16 | Archive a category used by an active deal, a tax class used by an active deal → `409 CONFIG_IN_USE` |

### 10.6 Snapshot and delivery

| # | Rule | Case |
|---|---|---|
| 57 | V12 | Built snapshot parses with `BranchConfigSnapshotSchemaV2`; `canonicalJson` stable across two builds (hash equal) |
| 58 | V12 | Item drawing from a stock item not counted at the branch → `stock_draws: []` there; slot route with `stock_time_ms` null → `stock_draws: []` |
| 59 | §4.6, V7 | Linked option price: override wins; else the linked item's branch override; option omitted where the linked item has no route; the linked item (serve mode `immediate`) is in the snapshot with its own `serve_mode`, `station_id` and `cook_time_ms`, and the plain options carry no station or timing fields |
| 60 | §3.2 | Variant group with no member routed at a branch → absent there |
| 61 | 01a S28 b | Hub on schema 2 receiving a schema 1 body → `schema_unsupported`, last config kept |
| 62 | §6.17 | Builder statement count fixed for 1 and for 50 deals |
| 127 | Q1, §4.6 rule 2 | Builder backstop (v0.6): group "Bread" (required, min 1) with plain "Butter" and linked Naan; Naan's row set in the database (bypassing the write rules) to `sale_unit 'g'`, then `requires_weighing: true`, then archived → in each case the Naan option is left out of `options[]` and "Butter" stays; with "Butter" also not offered at the branch → Bread kept with `options: []` (F1); Naan back to an active `piece` item → the option is back. Statement count unchanged (test 62) |

### 10.7 Hub

| # | Rule | Case |
|---|---|---|
| 63 | §6.18 | `SetPrecookedStock { stock_item_id: Karahi pot, on_hand: 6000 }` → one `StockSet` v2; Half shows `saleUnitsAvailable` 12, Full 6 |
| 64 | §6.18 | Unknown stock item → `404 STOCK_ITEM_NOT_FOUND`; duplicate → `400` path `entries.1.stock_item_id`; retransmit → replay; COMMIT failure → state unchanged |
| 65 | §6.18, B1 | `my_stations` holder of Karahi counts the Karahi pot → OK; the Tandoor's stock item → `403 outside_scope { stock_item_ids }` after the 404 checks |
| 66 | §5.3 | Upcasters: every `.v1.json` fixture of `StockSet`, `StockAdded`, `BusinessDayOpened` upcasts to its `.latest.json` |
| 67 | V5 | Boot fold over a log with v1 `StockSet` (item id) then a v2 `StockSet` (same id) → one entry, latest wins |
| 68 | §6.20 | `OpenBusinessDay` → `BusinessDayOpened` v2 with `stock_units` for each counted stock item and `draws` for each tracked item; a later unit change waits for the next open |
| 69 | §3.5.2 | `canServeFromStock` for Half (500) with 400 g available → false; Full with 1 000 → true |
| 70 | §6.21 | Stock query: one row per stock item with drawers; 1 statement when numbers sent; no deal rows |
| 71 | — | Retired in v0.3 (m9: `SetDealAvailability` deferred); number not reused |
| 72 | — | Retired in v0.3 (m9); number not reused |

### 10.8 Concurrency and races

| # | Case |
|---|---|
| 73 | Two concurrent group PATCHes with the same `expected_version` → one `200`, one `409 CONFIG_STALE` (row lock + version) |
| 74 | Concurrent item archive and a group POST linking that item → either the archive gets `409 CONFIG_IN_USE` or the POST gets `422 archived`; never both succeed (`FOR SHARE` on the linked item vs `FOR UPDATE` on archive) |
| 75 | Concurrent stock item `stock_unit` PATCH and an item POST drawing from it → serialised by the stock item lock; the loser sees the winner's unit and its rule result |
| 76 | Concurrent deal PUT at Gulberg and deal archive → archive first: PUT `is_sold: true` → `422 archived`; PUT first: archive succeeds, builder drops the archived deal |

### 10.8a Added in v0.2

| # | Rule | Case |
|---|---|---|
| 77 | §6.10 | Modifier group list: 5 statements (counter) for 1 and for 30 groups; `branches` only for allowed branches; archived options under `archived_options` |
| 78 | §6.13 | Deal list: 5 statements for 1 and for 20 deals; `branches` only for allowed branches |
| 79 | §6.19 | `AddPrecookedStock` on a stock item counted today → one `StockAdded` v2, `recorded_as: 'added'`; on one counted before the day open → one `StockSet` v2, `recorded_as: 'set'`; duplicate id → `400`; `my_stations` outside → `403` |
| 80 | 01a §6.16, E0-MENU edge | Route PUT for the Full variant to a station of another branch → `422 wrong_branch`; to an archived station → `422 archived`; the variant is not in that branch's snapshot |
| 81 | §4.6 rule 3 (F1) | Required group "Bread" (min 1) whose only option links an item not routed at Gulberg → Gulberg snapshot keeps the group with `options: []` and the item lists it; an optional group in the same state is absent from `modifier_groups` and `modifier_group_ids` |
| 82 | §6.21 (F4) | Stock item counted at Gulberg whose only drawer is not routed there → `has_tracked_drawers: false`; once the drawer is routed with a stock time → `true` |
| 83 | §6.5 R6 (D-3) | Naan and Roghni naan (both `piece`) as choices of one deal part; PATCH Naan `sale_unit: 'g'` → `409 CONFIG_IN_USE { entity: 'menu_item', used_by: { entity: 'deal', ids } }`, nothing written; the same change on the only choice of a part → `200` |
| 84 | §3.3, §6.4, §6.5 R7 (V18) | POST `requires_weighing: true` with `sale_unit 'piece'` → `400`; PATCH `sale_unit: 'piece'` alone onto a weighed `g` item → `400`; `requires_weighing: true` with `sale_unit 'g'` → `201`, in the snapshot with `requires_weighing: true` |
| 85 | §6.4, §6.5 R7 (V18) | Weighed item with a stock draw on POST → `422 weighed_item_stock_draw`; PATCH `requires_weighing: true` onto an item with a draw → `422`; PATCH adding a draw to a weighed item → `422` |
| 86 | §6.14, §6.15 R5, §6.5 R8 (V18) | Deal POST with a weighed choice → `422 weighed_item_in_deal` field `parts.0.choices.0.item_id`; PATCH `requires_weighing: true` on an item a deal part offers → `422 weighed_item_in_deal` field `requires_weighing` |
| 87 | §3.4.4, V18 | `orderLineTotalMinor` for a weighed line with `quantity: null` → `null`; with 1 250 g at 220 000 per kg plus a plain option 8 000 → 275 000 + 8 000 = 283 000 |
| 88 | §6.12a (V19) | PUT at Gulberg `[{ O1, is_offered: false }, { O2, is_offered: true, price_minor_override: 4000 }]` → Gulberg snapshot omits O1 and prices O2 at 4 000; DHA keeps both at base; one audit row `modifier_group` / `branch_set` with `branch_id` Gulberg; only Gulberg bumped |
| 89 | §6.12a, V19 | Linked option Naan (option `price_minor` null; Naan's Gulberg route override 3 500) with a Gulberg option override 2 500 → snapshot price 2 500; without the option override → 3 500 |
| 90 | §6.12a edges | `is_offered: false` with an override → `400`; repeated `option_id` → `400` path `options.1.option_id`; an option of another group, of another tenant, or archived → `422 not_found`; a foreign branch → `404 BRANCH_NOT_FOUND`; stale → `409 CONFIG_STALE { entity: 'modifier_group_branch' }`; `options: []` → rows deleted, audited; the same list again → no-op, no audit, no bump; an entry equal to the default is not stored |
| 91 | §6.12a race | O2 has no row at Gulberg. Concurrent §6.12 PATCH archiving O2 and §6.12a PUT overriding O2, both with fresh versions → serialised by the group lock: PATCH first → the Gulberg version is unchanged (no row for O2), so the PUT reaches the payload check and gets `422 not_found` for O2, nothing written; PUT first → the PATCH succeeds (its group version covers only the group's own fields, options and links), O2's Gulberg row stays and the builder ignores it while O2 is archived |
| 92 | §6.12a, F1 | Required Spice level with every option `is_offered: false` at Gulberg → `200`; Gulberg snapshot keeps the group with `options: []`; `isGroupSatisfiable` false for it (test 13 function) |

### 10.8b Added in v0.3 (G4)

| # | Rule | Case |
|---|---|---|
| 93 | B1, §4.3, §4.6 | Batch-routed item (route `program_id` P, `stock_program_id` Q) → the snapshot's `programs[]` resolves P and Q with their `cook_time_ms`, archived programs included (S22), so `program_cook_time_ms` / `stock_program_cook_time_ms` can be copied; a slot-routed item has `program_id` null (both copies null). §4.4 02 requires 02's `ItemAdded` tests to assert the copy |
| 94 | B2, §3.4.4, E3 | Deal Rs 1 500 × 2, part A 500 g karahi with the Mutton choice (+50 000), part B naan × 2 → deal `line_total_minor` = 300 000 + 50 000 × 2 = **400 000**; a piece part with extra 3 000 × part qty 4 × deal qty 2 → + 24 000 (test 10 kept) |
| 95 | B2, §3.4.3 | Plain option Extra raita 8 000 on the 500 g karahi part, deal qty 2 → charge 16 000 (`optionChargeMinor(8000, 1, 2, 'piece')`); deal qty 1 → 8 000 |
| 96 | M1, V9, §3.4.6 | Child position: group "Bread" (min 1, only linked options, `has_plain_options: false`) → not offered, no violation; "Spice level" (min 1, plain) with nothing chosen → violation; a group with `has_plain_options: true` and `options: []` at the branch → `isItemOrderable(…, 'child', …)` false, and `isDealOrderable` false when that item is the part's only choice. Mixed group (v0.4, N6): "Bread" min 1 with plain "No bread" (`max_quantity` 1, `is_offered: false` at the branch) and linked Naan (offered) → in a child position `isGroupSatisfiable` false (linked Naan never counts), item not orderable there; the same group with "No bread" offered → satisfiable, Naan still not accepted (`checkOptionChoices` violation if chosen); min 2 with one offered plain option of `max_quantity` 1 plus linked Naan → `isGroupSatisfiable(g, 'child')` false, `isGroupSatisfiable(g, 'line')` true |
| 97 | M2, §3.4.6 | Linked option Naan with `isAvailable(Naan, 3)` false (switched off, outside its windows, or `sold_out` at 2 left) → `checkOptionChoices` violation; with it true → none |
| 98 | M3 race | §6.2 category move of a group with 3 members ‖ §6.5 rename of one member → both commit in some order, never `40P01`; final state: every member in the new category, the renamed member keeps its new name |
| 99 | M4 race | Two concurrent §6.9 PUTs at Gulberg for a stock item with no row there, both sending the "no row" version → one `200`, one `409 CONFIG_STALE`; same for two §6.16 PUTs on a deal with no row |
| 100 | M5 | An item with 21 effective groups (written by two concurrent writes, or seeded directly) → the builder succeeds, the snapshot parses with `BranchConfigSnapshotSchemaV2` and lists 21 ids |
| 101 | M6 | Group with an archived member moved to category C2 → the archived member moves too (one `menu_item` audit row for it); restoring a member whose group is archived → `422 { field: 'variant_group_id', reason: 'archived' }`, nothing written |
| 102 | M8, §3.4.8 | Per-unit void split: `allocateDealMinor(78177, [1, 1])` = `[39088, 39089]`; `allocateDealMinor(12508, [1, 1, 1, 1])` = `[3127, 3127, 3127, 3127]`; the sum always equals the input |
| 103 | M9 | Same deal and branch: allocation with plain Naan chosen equals allocation with Roghni chosen (`[229315, 12508, 78177]`); an implementation that weights by the chosen item would give `[220689, 24075, 75236]` and fails |
| 104 | m1 (replaced in v0.4, N4) | `allocateDealMinor(95_921_642, [199_714_492_077_708, 199_714_492_077_708])` = `[47_960_821, 47_960_821]` (BigInt); floating-point `Math.floor(total × w / Σw)` gives `[47_960_820, 47_960_822]` and fails; a non-safe-integer input total throws; the property test (test 6) draws totals and weights across the full allowed ranges |
| 105 | m3 | Deal PATCH omitting part P2 → P2's row kept with `archived_at`, same ULID; its choices kept; the sent parts' choices rewritten; sending P2's id restores it with its choices |
| 106 | m4 | O2 archived with a Gulberg row; §6.12a PUT at Gulberg for O1 → O2's row is not deleted; restoring O2 (§6.12) brings its Gulberg override back into the snapshot |
| 107 | m5 | A group attached only to items not routed at Gulberg → absent from Gulberg's `modifier_groups`; choices with `sort_order` 2, 1 → snapshot lists them 1, 2; the version input changes when only a choice's `sort_order` changes |
| 108 | m14, V20 | Day open with the pot frozen in `g`; config adds Quarter (250 g) mid-day → `dayDraws(Quarter)` uses the config draw; the pot's config `stock_unit` changed to `piece` mid-day → Quarter's draw not used that day (untracked), used again after the next day open |
| 109 | m15 | Group PATCH re-sending a link to a category archived since the last save → `200` (unchanged link not re-checked); adding a new link to an archived target → `422 archived`; the builder ignores the archived target; archiving an item linked only by an option of an archived group → `200` (R4 ignores it) |
| 110 | m16 | `sold_out` Naan with 2 available, part needs 4 per deal → `isDealOrderable(deal, 1, …)` false; with 8 available and deal qty 2 → true |
| 111 | m10, §6.5 R1 | PATCH a member's `category_id` alone to another category → `422 category_mismatch`, nothing written |
| 112 | m10, §6.12, C9 | Modifier group PATCH whose body is only `expected_version` → `400` |
| 113 | m10, V8 | Effective set order: groups with `sort_order` 2, 1, 1 (ids b < a order resolved by id) → `modifier_group_ids` ordered by `sort_order`, then id |
| 114 | m10, §5.3 | Hub upgraded while a v1 day is open (v1 `BusinessDayOpened` + v1 `StockSet` in the log) → after the upgrade the fold gives the upcast `draws`; the stock query shows the frozen units; `canServeFromStock` uses the upcast `quantity_per_sale_unit` |
| 115 | m11, §8 | Owner Deals page: a deal sold at Gulberg whose part 2's only choice has no Gulberg route → "Not sold at Gulberg: part 2 has no routed choice"; Modifier groups page: a linked option whose item has no Gulberg route → "Not offered at Gulberg" (component tests); v0.4 N9: with the second menu page still loading (`next_cursor` not null) → "Checking branches…" and no warning; after the last page → the warning |
| 116 | m13 | Options "Raita" and "raita" in one group → `409 CONFIG_NAME_TAKEN { entity: 'modifier_option' }` on POST and on PATCH |

### 10.8c Added in v0.4 (G4 run 2)

| # | Rule | Case |
|---|---|---|
| 117 | N1, §3.4.8 | Family karahi deal ×1 (deal line 320 000; naan part allocated 12 508, 4 units, no options): void 2 of the 4 naan → refunds 3 127 + 3 127 = 6 254 (shares 1 and 2 of `[3127, 3127, 3127, 3127]`); then void the deal → refund 320 000 − 6 254 = 313 746; total refunded **320 000 exactly (Rs 3,200.00)** |
| 118 | N1, §3.4.8, B2 | Test 94's deal Rs 1 500 × 2 (line 400 000): part A 500 g, reference Chicken karahi (220 000/kg, sort 1), chosen Mutton (+50 000 per deal); part B naan × 2 (3 000). Weights 220 000 / 12 000, allocation 284 482 / 15 518; part A refundable 284 482 + 50 000 × 2 = 384 482 over **2 units (one per deal, never per gram)** → void portion 1 → 192 241, portion 2 → 192 241 (sum 384 482); then void the deal → 400 000 − 384 482 = 15 518; total 400 000 |
| 119 | N1, P4, §3.4.8 | Property test (1 000 random deals and void sequences: part units, option-child units, parent lines, the deal, in random order and mixes; v0.5 P4: also `piece` parent `item` lines with `option_child` lines, voided k of n units at a time, mixed with child-unit voids and whole-parent voids; v0.6 Q4: some parents also carry later-added children with `option_quantity: null`, which a partial parent void never touches): after every step the refunds on each line ≤ its refundable amount, the deal's total ≤ its `line_total_minor`, and the parent and its children together ≤ the sum of their refundable amounts; once everything is voided, refunds on each line equal its refundable amount, the deal's total equals its `line_total_minor` exactly, and the parent and its children together equal the sum of their refundable amounts exactly |
| 120 | N2 race, §6.5 | (a) Group path: item I in group A; a §6.5 PATCH on I reads A, and before it locks I another PATCH moves I to group B and commits → the first attempt rolls back and restarts, the second locks B then I and commits; no `40P01`. (b) No-group path: I in no group; a §6.5 PATCH (no `variant_group_id` in the body) reads null, and before it locks I another PATCH joins I to group B → restart; R1 runs under B's lock. (c) A test hook forcing a group change before the item lock on every attempt → `503 SERVICE_UNAVAILABLE` after 3 attempts, nothing written |
| 121 | N3 race | §6.11 POST of a group whose option links Naan Butter (member of variant group "Naan") and which links to that variant group ‖ §6.2 category move of "Naan" → both commit in some order, never `40P01`; the moved members and the new group are both present |
| 122 | N5, §3.4.6 | Linked option Naan that is on and in stock, but whose required plain group has `options: []` at the branch (F1) → `isItemOrderable(Naan, …, 'child', 3, …)` false, the option is not selectable and `checkOptionChoices` gives a violation; once a plain option of that group is offered → selectable, no violation; v0.5 P2 (line position): Karahi with a required group "Bread" (min 1) whose only options are linked Naan and Roghni → both sold out → `isGroupSatisfiable(Bread, 'line', …)` false and `isItemOrderable(Karahi, …, 'line', 1, …)` false; Roghni back in stock → both true; a plain option added to the group with both breads sold out → true |
| 123 | N8, §6.5 R9 | Archive item Quarter (the only drawer of stock item "Pot B"), archive "Pot B" (`200`, no active drawer), restore Quarter → `422 { field: 'stock_draws.0.stock_item_id', reason: 'archived' }`, nothing written; restore "Pot B" first, then Quarter → `200` |
| 124 | N9, §8 | Create-stock-item flow: the §6.7 POST's response is lost → the retry uses the same `Idempotency-Key` and gets the replayed `201` (one stock item); a §6.9 PUT succeeds but its response is lost → before retrying, the form re-reads §6.6, sees the branch row and its new version, and skips that PUT; no `409 CONFIG_STALE`, no `409 CONFIG_NAME_TAKEN` (component test with a mocked API) |
### 10.8d Added in v0.5 (G4 run 3)

| # | Rule | Case |
|---|---|---|
| 125 | P1, Q1, §6.5 R10, §6.12 R6 | Naan (`piece`, **no stock draw, in no deal part**, v0.6 Q2) linked by an active option of active group "Bread": PATCH Naan `sale_unit: 'g'` → `409 CONFIG_IN_USE { entity: 'menu_item', id: Naan, used_by: { entity: 'modifier_group', ids: [Bread] } }`, nothing written; PATCH Naan `requires_weighing: true` (with `sale_unit: 'g'`) → the same `409`; with the linking option archived → the `sale_unit` change `200`; restored, then with group "Bread" archived → `200`. **v0.6 Q1:** archive Bread → PATCH Naan `sale_unit: 'g'` → `200` → PATCH Bread `{ archived: false }` → `422 { field: 'options.0.linked_item_id', reason: 'linked_item_not_piece' }`, Bread stays archived; the same with Naan `requires_weighing: true` → `422 linked_item_not_piece`; with Naan archived instead → `422 archived`; Naan back to `piece` → restore `200` |
| 126 | P4, §3.4.8 | Parent `item` line Karahi × 2 (`piece`) with linked Naan option quantity 3 (child line 6 naan, `line_total_minor` 18 000): void 1 karahi → 3 naan voided, child refunds shares 1–3 of `allocateDealMinor(18 000, [1×6])` = 3 000 each, 9 000 in all; void the second karahi → the remaining 3 naan voided, 9 000; child total 18 000 exactly. Variant: 2 naan voided on their own first, then 1 karahi voided → 3 more naan; the last karahi → the last 1 naan. A 1.25 kg karahi (g) line with 3 naan → voided whole only (one unit); voiding it voids and refunds the 3 naan. **Later-added child (v0.6, Q4):** Karahi × 2 with Naan `option_quantity` 3 (child line 6 naan, 18 000) plus a naan added later under the same parent (`quantity` 1, `option_quantity: null`, 3 000): void 1 karahi → 3 naan of the first child line (9 000), the later line untouched; void the last karahi → the remaining 3 naan (9 000) and the later naan (3 000); each child line's refunds equal its `line_total_minor` |

### 10.8e Added in v0.6 (G4 run 4)

| # | Rule | Case |
|---|---|---|
| 128 | Q2, §6.5 rule precedence | Naan (`piece`) linked by an active option of active group "Bread" **and** offered with Roghni naan (`piece`) in one active deal part: PATCH Naan `sale_unit: 'g'` → `409 CONFIG_IN_USE { used_by: { entity: 'modifier_group', ids: [Bread] } }` (R10 before R6); with the Bread option archived → `409 { used_by: { entity: 'deal', ids } }` (R6); PATCH `{ sale_unit: 'g', requires_weighing: true }` with the option active → `409` modifier group (R10 before R8's `422`); PATCH `{ requires_weighing: true }` alone on the `piece` Naan → `400` (R7's `400` first); PATCH `{ archived: true }` → `409` modifier group (R4, as before); with a draw to a `piece` stock item and the Bread option active, PATCH `sale_unit: 'g'` → `409` modifier group (R10 before R2's `422 unit_mismatch`); the same with the Bread option and the deal part archived → `422 unit_mismatch` (R2) |

### 10.9 Acceptance table (story AC → endpoint → test)

| Story AC | Endpoint(s) | Tests |
|---|---|---|
| E0-MENU AC4 variants override price, cook time, station | §6.4, §6.5, 01a §6.16 | 21, 22, 57 |
| E0-MENU AC5 add-ons add price, may change station | §6.11, §6.12 | 3, 4, 9, 36, 39, 59 |
| E0-MENU AC6 combos, one line at the combo price | §6.14–§6.16 | 5–8, 10, 49, 54, 94, 103 |
| E0-MENU edge: variant to unconfigured station | 01a §6.16 (route rules) | 80 |
| E0-MENU edge: combo with unavailable item | §4.2 `isDealOrderable` | 14, 55, 96, 110 |
| E0-MENU edge: zero-price add-on | §6.11 | 36 (free options) |
| E1-ROUTE AC1 serve mode per modifier (narrowed, V7) | §6.11, §4.6 | 59 |
| E1-ROUTE AC3 modifiers override price, cook time, station | §6.4, §6.11 | 21, 39, 59 |
| E1-ROUTE edge: modifier to unconfigured station | builder §4.6 | 59 |
| Carried: stock pools | §6.7–§6.9, §6.18–§6.21 | 27–35, 63–70 |
| Carried: line totals through `lineTotalMinor` | §4.2 | 9, 10, 87 |
| G3 E1: weighed items (`requires_weighing`) | §6.4, §6.5, §6.14, §6.15 | 84–87 |
| G3 E2 / 8: options and prices per branch | §6.12a | 88–92 |
| G3 5 / F1: required group kept when empty at a branch | §6.17 builder | 81, 92 |
| G4: contracts to 02/03a/04 (batch copy, per-unit voids, refunds never above billed, partial parent voids) | §4.3, §4.4 | 93, 102, 117–119, 126 |

Coverage: 15 of 15 rows have at least one test (100 %).

---

## §11. Build order

1. **Migration** `apps/cloud/src/db/migrations/0006_menu_variants.sql` (§5.1); read the real CHECK names first. Test 27. [§5.1]
2. **Errors** `@pos/domain/src/errors.ts` + F §6.2 append (§9).
3. **Domain** `packages/domain/src/menu-lines.ts` + tests 1–14, 94–97, 102–104, 110, 117–119, 122, 126. [§3.4, V11]
4. **Events** `StockSet.v2`, `StockAdded.v2`, `BusinessDayOpened.v2`, upcasters, fixtures; test 66. [§5.3]
5. **Engine** re-key `stock.ts`, `state.ts`, `apply-event.ts`; `ENGINE_STATE_VERSION` bump + fixture; re-key 01a tests 66, 116, 129, 131, 132, 148, 157; tests 67, 69, 108. [V5, V20]
6. **Snapshot schema 2** `packages/events/src/config.ts`; `isStockTracked`. [V12, §4.6]
7. **Cloud admin schemas** `packages/events/src/admin/menu-variants.ts`, `restaurant.ts` changes; `versions.ts`. [§5.4]
8. **Cloud variant groups + item changes** §6.1–§6.5 (lock order §6 table, M3, N3; §6.5 restart rule, N2); re-key 01a test 128 (item unit fields → stock draws, v0.4 N7); tests 15–26, 101, 111, 123, 125, 128 (§6.5 rule precedence, v0.6 Q2). [Batch 1]
9. **Cloud stock items** §6.6–§6.9 + station in-use; tests 28–35. [Batch 2]
10. **Cloud modifier groups** §6.10–§6.12 (§6.12 R6, v0.6 Q1, and the restore part of test 125); tests 36–48, 112, 113, 116. [Batch 3]
11. **Cloud deals** §6.13–§6.16 + category / tax class in-use; tests 49–56, 105. [Batch 4]
12. **Builder** `config-sync/builder.ts` schema 2; tests 57–62, 93, 100, 107, 109, 127 (rule 2 backstop, v0.6 Q1); re-key 01a tests 4, 140. [§6.17]
13. **Route cases** `test/helpers/route-cases.ts` (C7); races 73–76, 98, 99, 120, 121.
14. **Hub** stock commands, open day, stock query, catch-up; re-key 01a tests 59–61, 67, 72, 73, 89, 91, 93, 130, 133, 134, 143, 145, 147, 149, 152, 156, 158 and 01b 9–11; tests 63–65, 68, 70, 114. [Batch 5]
15. **Owner app views** and item form (§8); **stock page** (§8); re-key 01a tests 77, 166, 167, 171; tests 115 (m11 warnings, shown after the last page), 124 (m7 / N9 create-stock-item flow and its retries).
16. **Seed** `cli/seed-demo.ts` (§7); 01a test 41 replaced by test 21.
17. **Weighed items** (V18): column in step 1; item rules §6.4 / §6.5 R7–R8, deal rule §6.14–§6.15 R5, `orderLineTotalMinor` null; tests 84–87.
18. **Per-branch options** (V19): table in step 1; §6.12a route, version input, builder rule 2–3; owner page tab; route case (C7); tests 77, 81, 88–92, 106.
19. **D-3 rule** §6.5 R6; test 83. **F4** stock query flag; test 82. Tests 78–80.
20. **Spec bumps on approval:** 01a → v2.0, 01b → v1.2, README rows (§4.5).

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done

- Every numbered test 1–128 (71 and 72 retired) passes, cites `[01c #N]`, and every re-keyed 01a/01b test passes.
- `pnpm -w typecheck`, `lint`, `test` green; route-inventory and cross-tenant sweeps include every new route (C7).
- Snapshot 2 built for the seed tenant parses on the hub; a hub on schema 1 refuses it visibly.
- The stock page shows the Karahi pot once with Half and Full under it; counts and adds work end to end.
- 01a v2.0, 01b v1.2 and README updated with "Changed by 01c" markers (R26) when this spec is approved.

### 12.2 Endpoint checklist

| § | Endpoint | Auth | Versioned | Idempotency | Audit | Tests |
|---|---|---|---|---|---|---|
| 6.1 | `POST /v1/admin/variant-groups` | owner, every branch | — | key | yes | 15, 16 |
| 6.2 | `PATCH /v1/admin/variant-groups/:id` | same | yes | — | yes (+C5) | 17–20, 98, 101, 121 |
| 6.3 | `GET /v1/admin/menu` | owner | — | — | — | 26 |
| 6.4 | `POST /v1/admin/menu-items` | owner, every branch | — | key | yes | 21–23, 84, 85 |
| 6.5 | `PATCH /v1/admin/menu-items/:id` | same | no (S23) | — | yes | 24, 25, 83–86, 98, 101, 111, 120, 123, 125, 128 |
| 6.6 | `GET /v1/admin/stock-items` | owner | — | — | — | 35 |
| 6.7 | `POST /v1/admin/stock-items` | owner, every branch | — | key | yes | 28, 124 |
| 6.8 | `PATCH /v1/admin/stock-items/:id` | same | yes | — | yes | 29, 30 |
| 6.9 | `PUT /v1/admin/stock-items/:id/branches/:b` | owner, branch | yes | PUT | yes | 31–34, 99 |
| 6.10 | `GET /v1/admin/modifier-groups` | owner | — | — | — | 77 |
| 6.11 | `POST /v1/admin/modifier-groups` | owner, every branch | — | key | yes | 36–41, 116, 121 |
| 6.12 | `PATCH /v1/admin/modifier-groups/:id` | same | yes | — | yes | 42–48, 109, 112, 113, 116, 125 |
| 6.12a | `PUT /v1/admin/modifier-groups/:id/branches/:b` | owner, branch | yes | PUT | yes | 88–92, 106 |
| 6.13 | `GET /v1/admin/deals` | owner | — | — | — | 78 |
| 6.14 | `POST /v1/admin/deals` | owner, every branch | — | key | yes | 49–51, 86 |
| 6.15 | `PATCH /v1/admin/deals/:id` | same | yes | — | yes | 52, 53, 86, 105 |
| 6.16 | `PUT /v1/admin/deals/:id/branches/:b` | owner, branch | yes | PUT | yes | 54–56, 99 |
| 6.17 | `GET /v1/sync/config`, `/queries/branch-config` | branch key / device | — | — | — | 57–62, 81, 92, 93, 100, 107, 109, 127 |
| 6.18 | `SetPrecookedStock` | `manage-stock` | — | `command_id` | event | 63–65 |
| 6.19 | `AddPrecookedStock` | `manage-stock` | — | `command_id` | event | 79 |
| 6.20 | `OpenBusinessDay` | `manage-stock` (branch) | — | `command_id` | event | 68, 114 |
| 6.21 | `GET /admin/queries/stock` | `manage-stock` | — | — | — | 70, 82 |

### 12.3 Open questions (developer)

**All v0.1 questions are answered (v0.2).** None is open.

| # | Question | Answer (developer, 2026-10-28) | Where |
|---|---|---|---|
| D-1 | Allocation with a zero-weight part | Confirmed: pro rata by effective branch price × quantity; a zero-price part gets 0; equal split only when every weight is 0 | V11 c, test 7 |
| D-2 | One order item per line, or n | Provisional, carried to 02: 02 decides; 01c's child-line and allocation rules assume one line with quantity and are re-checked if 02 splits | §4.3, §4.4 02 row |
| D-3 | A choice item's `sale_unit` change breaking a deal part | No silent drop: `409 CONFIG_IN_USE { used_by: { entity: 'deal', ids } }` (01a S22 pattern); the builder-drop default is removed | §3.3, §6.5 R6, test 83 |
| D-4 | When to drop the deprecated `menu_items` columns | In the first release after 02 ships | §12.4 |
| D-5 | Per-item draws in `BusinessDayOpened` v2 | Kept, frozen for the open day (01a S44 rule) | V20 |

**Author's calls in v0.2** (made while applying the answers; each is checkable in the hostile review):

| # | Call | Where |
|---|---|---|
| AU-1 | §6.12a stores differences only: an entry equal to the default (`is_offered: true`, no override) is dropped, and a CHECK refuses storing one | V19, §5.1 |
| AU-2 | Options are written by upsert (not delete + insert) so per-branch rows survive edits; option-name uniqueness moves from a partial index to a service check under the group lock | V14, §5.1 |
| AU-3 | §6.12a locks the group `FOR UPDATE`, serialising it with §6.12 and other branch PUTs of the group; an archived group's branch rows → `422 archived` | §6.12a |
| AU-4 | Effective option price order: branch override > option `price_minor` > linked item's effective branch price | V19, §4.6 rule 2 |
| AU-5 | A `sale_unit` change on the only choice of a part is allowed (R6 fires only when a part would mix units) | §6.5 edge table |
| AU-6 | §6.12a audit uses entity `modifier_group` with action `branch_set` for every change, an emptied list included | §6.0, §6.12a |

**Author's calls in v0.3** (made while applying G4):

| # | Call | Where |
|---|---|---|
| AU-7 | M1 needs the snapshot to tell "all options linked" from "plain options configured but none offered here": new field `modifier_groups[].has_plain_options` | §4.6 rule 3, V9 |
| AU-8 | Removed tests 71, 72 are retired, not renumbered (01a convention: removed numbers are never reused), so every existing test citation stays valid | §10 |
| AU-9 | **Superseded in v0.4 by the developer's N2 decision** (roll back and restart, at most 3 attempts, then `503`; no group lock ever follows the item lock). Was: §6.5 repeats the step once with the new group | §6 "§6.5 restart rule" |
| AU-10 | The B2 charge on a g/ml deal part reuses `optionChargeMinor` with parent quantity = deal qty and unit `'piece'`, no new function | §3.4.3 |
| AU-11 | The reference choice is the first choice **in this branch's snapshot** (an unrouted first choice is skipped), so every branch has a defined weight | V11 c |

### 12.4 Deferred until needed

| Item | Trigger |
|---|---|
| Split a pick-one part across choices (1 Roghni + 1 plain) | An owner asks for it at a deal |
| Per-attachment group rules (min/max per item) | An owner needs the same group with different rules on two items |
| More than one draw per item | The inventory module (recipes) |
| Weighed items as deal parts, or with stock draws (V18 pilot limits) | An owner sells a weighed dish in a deal, or counts a weighed dish's stock |
| Images for variants and deals | E0-MENU AC2 images are built for items |
| Drop deprecated `menu_items` columns (contract) | The first release after 02 ships (D-4) |
| Deal suggestion during ordering | Proposed README carried row (G3 6); needs item cost |
| Days-of-week windows for deals | 01a deferral of the same for items is lifted |
| Deal-level modifier groups | An owner needs a choice that is not a part |
| Deal On/Off toggle on the hub (`SetDealAvailability`, `DealMade*` events, `deal_availability` projection, Deals tab on the stock page) (v0.3, m9) | An owner asks to pause a deal mid-service |

### 12.5 G3 answers (owner and developer, 2026-10-28)

The v0.1 owner questions are answered; no `[ASSUMPTION]` remains in this spec.

| # | Question | Answer | Effect on this spec |
|---|---|---|---|
| 1 | Which dishes come in sizes? | Variants are fully generic: any number per group, any names the owner chooses (Half/Full/Quarter, Medium/Large/Jumbo); no dish-specific rule anywhere. Raw-ingredient use per variant is the recipe inventory module's | §1 "Generic model" row; dishes in this spec are seed examples; §4.4 inventory row (R28); 01c guarantees one `item_id` per variant |
| 2 | Do half and full come from one pot? | Closed: the model supports a shared or a separate stock item per variant | No default needed (V3, V4) |
| 3 | Which counter counts each pot? | Closed: the owner sets the counting station per stock item and branch | No default needed (V3, §6.9) |
| 4 | Which extras exist? | Extras and toppings (pizza toppings, extra gravy) are plain paid options; their ingredient effect is recipe deltas in R28 | V6 unchanged; §4.4 inventory row |
| 5 | Must the customer always pick, e.g. spice level? | A default option (Normal) is preselected but changeable | §4.4 02 row: a group with a default is always shown on the order sheet |
| 6 | How are deals sold? | Owner-built "pick a slot" deals are pick-one parts; promoting a new item = a deal in a category placed first (existing category + `sort_order`), no new field | V10 unchanged; proposed README carried row "deal suggestion during ordering" (§4.5), not 01c |
| 7 | Swap a deal item for a better one by paying extra? | Yes, a set extra per swap | V10 `extra_price_minor` (as drafted) |
| 8 | Same extras and prices at all branches? | No: options and their prices can differ per branch (rent and costs differ by area) | **V19**, §6.12a, tests 88–92 |
| 9 | Extras on a line sold by weight? | A plain option on a g/ml line is charged once per line | §3.4.3 (as drafted), test 4 |
| 10 | Money back for a cancelled deal part? | Yes: its `allocated_price_minor` share | §4.4 04 row (as drafted) |
| 11 | Extras on an item inside a deal? | A separate line | V9 (as drafted) |
| E1 | Dishes priced by weight known only later (fish at the counter, desi murga after slaughter) | `requires_weighing`: weight entered at ordering or later, one mechanism | **V18**, tests 84–87; carried rows 02, 03a, 05 |

### 12.6 G2 self-check

| Check | Result |
|---|---|
| Missing sections | None: §1–§12 present in README order |
| Endpoint count | 01c's own routes **14** (inside 10–25); 22 touched with the 8 changed 01a routes; no split (> 30) |
| Story AC → endpoint → test coverage | 15 / 15 rows of §10.9 (11 story and carried rows, 3 G3 rows, 1 G4 row) mapped to an endpoint and at least one numbered test: **100 %** |
| Every write has an edge-case table (C1, C2, C4, C5, C6) | All 16 writes: 6.1, 6.2, 6.4, 6.5, 6.7, 6.8, 6.9, 6.11, 6.12, 6.12a, 6.14, 6.15, 6.16, 6.18, 6.19 (by reference to 6.18's table), 6.20 (6.22 removed in v0.3). Merged-row rules named per PATCH/PUT: 6.2 R1–R3, 6.5 R1–R10 (with a stated precedence, v0.6 Q2), 6.8 R1–R3, 6.12 R1–R6, 6.12a (none on the group; F1 stated), 6.15 R1–R5 |
| Unnamed overrides | None found. Named: F §4.7 and F §5.9 step 5 (V5); 01a S23 for new tables (V13); 01a S28 c (V1, V12); 01a S59 pending weight (V18); 01a §6.9, §6.12, §6.13, §6.15 in-use checks (V16, §6.5 R6); E1-ROUTE AC1 narrowed (V7); C5 application for children (V15); C4 divergence inherited for 01a tables (V13); v0.3: 01a §4.4 batch cook-time copy kept (A6, B1), 01a §4.3 tracked rule changed (A2, m7) |
| Load-bearing assumptions | **None open.** Settled: data model V2–V4, V14 (upsert, AU-2), V18, V19; events V5, V20, §4.3 (D-2 carried to 02 with a re-check rule); snapshot V12; money V11 (D-1 answered), §3.4 (G3 9 answered), V19 price order (AU-4). Owner facts G3 1–11 and E1 answered (§12.5) |
| Hostile self-review notes | G4 run 1 (`docs/reviews/01c_hostile_G4.md`) applied in v0.3, run 2 (N1–N9) in v0.4, run 3 (P1–P5) in v0.5, run 4 (Q1–Q4) in v0.6. Every 01c write checked against the §6 lock-order table, and every §6 script states its locks in that order (v0.5, P3). Races 73–76, 91, 98, 99, 120, 121 cover version, archive vs link, unit change vs draw, deal archive vs branch PUT, option archive vs branch PUT. No N+1: every read and the builder use fixed statements. Author's calls AU-1–AU-11 (AU-9 superseded) listed in §12.3 for the review |

### 12.7 Build-time fixes (from G4 run 5)

From `docs/reviews/01c_hostile_G4.md` "Run 5 — v0.6" (APPROVE, 0 BLOCKER, 0 MAJOR). None changes a contract another module consumes; each is applied by the plan task named, except T2, which is carried to 02.

| # | Sev | Section | Finding (run 5) | Build-time fix | Carried to |
|---|---|---|---|---|---|
| T1 | MINOR | §6.12 script vs R6 and §6 table row 4 | The script locks the stored linked items "when the merged group is active and `options` is not sent", which also covers a rename or a `min_choices` change on an active group, where R6 does not run; R6 and table row 4 say "on a restore". R6 gives `linked_item_not_piece \| archived` with no order for an item that is both archived and `g`. Test 125's last steps ("restored", "Naan back to `piece`") skip the steps in between | Lock the stored linked items only when R6 runs (restore without `options`). Check `archived` before `linked_item_not_piece`, as 01a's `assertReference` does. Write test 125 as explicit steps | plan, §6.12 task |
| T2 | MINOR | §4.4 02 "Later additions" | The unit of "`max_quantity` is checked over the parent's children" is not stated. A placed child has a quantity per parent unit (`option_quantity`); a later child has only a line `quantity`. Karahi × 2 with Naan `option_quantity` 3 (6 naan), `max_quantity` 6: one more naan gives Σ 7 > 6 per line, 3.5 ≤ 6 per parent unit | For a `piece` parent, Σ child line `quantity` ≤ `max_quantity` × parent `quantity`; for a g/ml parent, ≤ `max_quantity`. 02 owns whether later additions are allowed at all | **02** (README carried row) |
| T3 | MINOR | §4.2 `checkOptionChoices` | `checkOptionChoices(groups, chosen, position, groupsById, itemsById, isAvailable)` cannot compute the child quantity (`childQuantity(optQty, parentQty, parentSaleUnit)`) that N5 needs: it has neither the parent quantity nor the parent `sale_unit`. `isGroupSatisfiable` and `isItemOrderable` put `position` in different places | Add `parent: { quantity, sale_unit }` to `checkOptionChoices` (`quantity` may be null while a weight is pending; a g/ml parent does not need it). Optionally one parameter order | plan, `menu-lines.ts` task |
| T4 | MINOR | §6.5 rule precedence vs the 01a code | `patchMenuItem` (`apps/cloud/src/modules/restaurant/service.ts:897–913`) runs no-op → `assertUnits` (400) → `stock_time_exceeds_cook_time` (422) → category and tax-class reference checks → route checks on restore → name index at the write. Extended in place, `{ sale_unit: 'g', cook_time_ms: < stock_time }` on a linked Naan gives `422` (code) instead of `409` (spec). Test 128 covers no 01a `422` and no sent reference | Restructure `patchMenuItem` so R4, R10, R6 (`409`) come before 01a's `422`s, per the precedence; add a test-128 case: linked Naan, `{ sale_unit: 'g', cook_time_ms: < stock_time }` → `409` modifier group. **Developer decision (2026-10-29):** §6.5 keeps 01a's built check order for `menu_items`: the no-op step runs before the reference checks, so re-sending an unchanged archived category → `200`. This is part of the V13 C4 divergence (V13, §6.5 "Rule precedence"); 01c's merged rules R1–R10 run after the no-op step in the §6.5 precedence | plan, §6.5 task |
