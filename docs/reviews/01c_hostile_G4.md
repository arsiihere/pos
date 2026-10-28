# 01c Menu — Hostile review G4 (spec v0.2)

Target: `docs/specs/01c_Menu_Variants_Spec_v0.2.md` (commit f80c033). Read with README C1–C9 and R-rows, 01a v1.3.1, 01b v1.1, Foundation v1.7 (cited sections only), `docs/reviews/01c_gate_G2.md`. I checked the spec's claims against the code in `apps/cloud`, `apps/hub`, `packages/{events,engine,domain}` and `apps/client`. Date 2026-10-28. The spec was not edited.

**Verdict: CHANGES REQUIRED** — 2 BLOCKER, 9 MAJOR, 16 MINOR.

---

## Worked examples (money)

| # | Case | Hand result | Spec / test | Match |
|---|---|---|---|---|
| E1 | §4.3 family deal: 320 000 over weights 220 000 / 12 000 / 75 000 (Σ 307 000) | ⌊70.4e9/307 000⌋ = 229 315; ⌊3.84e9/307 000⌋ = 12 508; remainder 78 177; Σ 320 000 | §4.3, test 8 | yes |
| E2 | Test 8 with Roghni ×4. F2 says the weight uses the **chosen** item's price. If Roghni costs Rs 60 (6 000) the weights are 220 000 / 24 000 / 75 000 (Σ 319 000) | 220 689 / 24 075 / 75 236; naan part with extras 24 075 + 12 000 = **36 075** | test 8 expects **24 508**, which is right only if Roghni costs the same as Naan | test cannot tell (M9) |
| E3 | Deal Rs 1 500 × **2**: part A is 500 g karahi (Rs 2 200/kg), the swap to Mutton is +Rs 500; part B is naan ×2 (Rs 30) | weights `lineTotalMinor(220000,1000,'g')` = 220 000 and 12 000 (Σ 232 000); allocation of 300 000 = 284 482 / 15 518. Billed by §3.4.4 (g/ml extra "once") = 300 000 + 50 000 = **350 000**. Two swapped karahis should bill **400 000** | §3.4.4, V11 a | **wrong by Rs 500** (B2) |
| E4 | Tests 1–4, 9, 10, 63, 69, 87, 89 | 6; 3; 16 000; 8 000; 275 000 + 8 000 and 230 000 + 16 000; 640 000 + 24 000; 12 / 6; false / true; 283 000; 2 500 / 3 500 | §10 | yes |

---

## Findings

| # | Sev | Section | Finding | Evidence | Proposed fix |
|---|---|---|---|---|---|
| B1 | **BLOCKER** | §4.3, §4.5 A6 | `ItemAdded` v1 has no `program_cook_time_ms` or `stock_program_cook_time_ms`. 01a requires an order line at a batch station to copy both (D25), because at a batch station the item's `cook_time_ms` / `stock_time_ms` are not used (01a §4.3). A6 "replaces" the 01a §4.4 rows 02 and 03a but never says this requirement is dropped, so it is an override with no name. Without these fields 03a cannot time a batch line, or any batch deal part or option child, from the event. It would have to re-read config, which breaks D25 when the cook time changes mid-service. | 01a `docs/specs/01_Restaurant_Setup_Spec_v1.3.1.md:322` ("at a batch station the programs' `program_cook_time_ms` and `stock_program_cook_time_ms`"), `:316`; README carried 02 row "Batch lines also copy the programs' cook times"; spec §4.3 lines 202–205 | Add `program_cook_time_ms: number \| null` and `stock_program_cook_time_ms: number \| null` to §4.3 (null off batch and on `deal`), copied from the snapshot's `programs[]`. Name it in A6 and add a test. |
| B2 | **BLOCKER** | §3.4.4, V11 a, §3.4.3 | On a g/ml deal part, the choice's extra is charged "once" per deal line, whatever the deal quantity. The part's plain option charges are also charged once, because the `deal_part` line is g/ml. Two deals with a swapped karahi pay one swap (E3: under-charge of Rs 500). G3 9 ("once per line") was answered for a customer's single weighed line. A deal × n is n customer portions merged into one line. The allocation adds the extra "× its piece count", which has no meaning for g/ml. | §3.4.4 line 139 "g/ml part: once"; §3.4.3 line 138; worked example E3; test 10 covers only a piece part | For deal parts, multiply by the **deal quantity**: a piece part's extra is × part qty × deal qty, a g/ml part's extra is × deal qty. Plain options on a `deal_part` use parent quantity = deal qty for g/ml parts. Fix the allocation's "extra × piece count" to match. Add tests: a g/ml part with an extra at deal qty 2, and a plain option on a g/ml part at deal qty 2. |
| M1 | MAJOR | V9, §3.4.6, §4.2 `isDealOrderable`, F1 | In a child position, linked options are ignored, but `min_choices` still counts. Take a part item with a required group whose options are all linked (e.g. "Bread", min 1, linked Naan). `checkOptionChoices(…,'child')` always reports a violation, so the deal can never be submitted. Yet the snapshot keeps the deal and `isDealOrderable` (which takes only `isItemOrderable(itemId)`, with no group check) calls it orderable. The same happens to an option child whose item has such a group, and to a part item with an F1 empty required group. | §3.1 V9 line 88; §3.4.6 line 141; §4.2 line 170; §4.6 rule 3 | Define the effective groups in child position: plain options only, and a group left with no plain option counts as satisfied-empty **or** makes the item invalid as a choice. Pick one. Make `isDealOrderable` / `isItemOrderable` use `isGroupSatisfiable` for the position. Add a test. |
| M2 | MAJOR | §3.4.6, §4.4 02 row, V6 | Nothing requires a **linked option's item** to be orderable at order time: toggled On, inside its windows, not sold out. The snapshot drops only unrouted linked items. `checkOptionChoices(groups, chosen, position)` gets no availability input. So 02 can sell an 86'd naan as an add-on, or a `sold_out` naan at 0 stock. | §4.2 line 170 signature; §4.6 rule 2 line 353 | Add `isItemOrderable` to `checkOptionChoices` (or a separate rule in §3.4). A linked option whose item is not orderable is shown disabled and refused by `SubmitOrder`. Add a test. |
| M3 | MAJOR | §6.2 vs §6.5, 01a S8 lock order | Possible deadlock. A §6.2 category move locks the group `FOR UPDATE`, then `UPDATE menu_items … WHERE variant_group_id` (exclusive locks on the members). A §6.5 member PATCH locks the item `FOR UPDATE` (`repository.ts:628`), then the referenced group `FOR SHARE` (§6.4 "lock the variant group FOR SHARE"; the 01a PATCH re-locks references whenever the item is active, `service.ts:885–891`). That is opposite orders: group→item and item→group. Postgres then aborts one transaction with 40P01, which becomes a `500`. S8's order (target, references `FOR SHARE`, branches) has no slot for "update the referencing rows". | spec §6.2 line 613, §6.4 line 634; `apps/cloud/src/modules/restaurant/service.ts:885`, `repository.ts:628`; 01a S8 | Use one order: group before item. In §6.5, when the stored or merged `variant_group_id` is non-null, read the item without a lock, lock the group `FOR SHARE`, then lock the item `FOR UPDATE` and re-read it. In §6.2, lock the members `FOR UPDATE` in `item_id` order after the group. State this in §6. Add a race test: group move ‖ member rename. |
| M4 | MAJOR | §6.9, §6.16, V13 | The versioned branch PUTs are not safe when the row does not exist yet. "Lock the `stock_item_branches` row FOR UPDATE" locks nothing when the row is missing. The parent (stock item / deal) is locked only `FOR SHARE`, which does not serialise two PUTs. Two tabs that both loaded "no row" both pass the version compare. Both upsert, and the second silently overwrites the first, which is the exact case V13 exists to stop. §6.12a avoids this by locking its group `FOR UPDATE`. | §6.9 line 702; §6.16 line 828; contrast §6.12a line 765 | Lock the stock item / deal row `FOR UPDATE` (or `FOR NO KEY UPDATE`) in §6.9 / §6.16, as §6.12a does. Add a race test: two first-time PUTs → one `200`, one `409 CONFIG_STALE`. |
| M5 | MAJOR | V8, §3.3 "effective set ≤ 20" | The limit is not race-safe. A group write attaching to category C and an item PATCH moving an item into C both take only `FOR SHARE` on C. Each checks against the other's pre-commit state, both commit, and the item ends up with 21 groups. The spec does not say whether `BranchConfigSnapshotSchemaV2` caps `modifier_group_ids`. If it does `.max(20)`, the hub rejects the **whole** snapshot and the branch's config freezes (01a S28 / S43). | §3.3 line 122; §4.6 (no max stated); §6.5 R3, §6.12 R5 | State that the snapshot schema and builder put no cap on `modifier_group_ids` (the 20 is a write-time soft limit). Otherwise serialise both writes on the target row `FOR UPDATE`. Add a test either way. |
| M6 | MAJOR | §3.2.4, §6.5 R1, §3.3 | Restoring an archived variant member skips the group rules. (a) §6.2 moves only **active** members. A member archived before the move, then restored with `{archived:false}`, keeps the old category, and R1 runs only "on a change of either" field. The member and its group then sit in different categories, so the wrong category windows apply. (b) An archived member can be restored into an **archived** group: the active-group check runs only when `variant_group_id` is sent. The builder then emits an item whose `variant_group_id` is not in `variant_groups[]`. | §3.2.4 line 106; §6.2 script line 613 "`AND archived_at IS NULL`"; §6.5 R1 line 650 | Run R1 and "group is active" on restore (C4 step 6, merged row). In §6.2, also move archived members. Add a test for each. |
| M7 | MAJOR | §4.3, §4.4 02/05/07, V18 | The weighed-line contract is half-defined. `ItemAdded` carries `quantity: null` and `line_total_minor: null`. The event that completes the line is left wholly to 02, so 05 (bill), 07 (sales), 04 (refund) and R28 (depletion) cannot read their numbers from any contract 01c guarantees. The spec also does not say whether the later total uses the copied `price_minor` (D25) or the price at weighing time. | §4.3 lines 193–194, 209; §4.4 02 row ("02 owns … `SetLineWeight`-style command") | In §4.4 02, require the weight event to carry at least `{ order_item_id, quantity, line_total_minor }`. `line_total_minor` = `orderLineTotalMinor` over the **ItemAdded copy** (price and options, D25), with weights on the S59 50 g steps. 05, 07 and R28 read that event. |
| M8 | MAJOR | §4.4 04 row, D-2 | Partial voids are not defined. A `deal_part` line holds part qty × deal qty, e.g. 8 naan for deal ×2. 04's rule is "refund = its `allocated_price_minor`", which covers only a whole-line void. There is no per-unit split rule, and splitting `allocated_price_minor` by quantity needs its own rounding. Also undefined: does voiding a parent `item` void its `option_child` lines? D-2 is deferred to 02, but the effect falls on 04 and 05. | §4.4 04 row line 243; §4.3 "Rules for 02" line 234 | Pick one: (a) a `deal_part` / `option_child` line is voided whole only, or (b) a per-unit refund = `allocateDealMinor(allocated, [1…1])`. State the parent→child void rule. Carry both to 04 by name. |
| M9 | MAJOR | §10 test 8, F2 | Test 8 passes with the F2 rule broken. Roghni's price is never given, and the expected 24 508 holds only if Roghni costs the same as Naan. An implementation that weights by the part's **first** (or default) choice would also pass (E2). No other test fixes the F2 weight. | test 8 line 959; E2 above | Give Roghni Rs 60 (6 000) in the fixture. Expect `[220689, 24075, 75236]`, and naan `allocated_price_minor` 36 075. |
| m1 | MINOR | §4.2 `allocateDealMinor` | "Integer arithmetic" does not say BigInt. total × weight can pass 2⁵³ inside the allowed ranges (deal up to 1e9 × qty, weights up to 1e15). Test 6's property test over the full range would catch it, but only if its generator spans the range. | `packages/domain/src/line-total.ts:12` uses BigInt; spec silent | Use BigInt internally and throw on a result that is not a safe integer, like `lineTotalMinor`. Set the property test's ranges. |
| m2 | MINOR | V11 c, F2 | Weighting by the chosen item means a dearer swap moves allocation away from the other parts. The swapped part gets both the higher weight **and** the extra on top, so 07's per-item sales for the karahi change with the naan picked. This may be intended, but it is not stated. | V11 c line 90 | State it as intended, or use the part's reference (first or cheapest) choice as the weight and add only the extra. |
| m3 | MINOR | V14 | "Parts and choices … rewritten with one `DELETE` + one multi-row `INSERT`" contradicts "a stored active row left out is archived, never deleted", and ignores the FK order (`deal_part_choices` → `deal_parts`). A builder could lose archived parts. | V14 line 93 | Upsert parts like options and rewrite only the choices. Or state that archived parts are re-inserted with their `archived_at`. |
| m4 | MINOR | §6.12a vs §6.12 edge | "`DELETE` the group's rows at this branch" would also delete rows of **archived** options. The §6.12 edge says "restoring the option brings them back". | §6.12a line 765; §6.12 edge line 757 | Delete only the rows of the group's active options. |
| m5 | MINOR | §4.6 | (a) Which groups go into `modifier_groups[]` (all active, or only those referenced at the branch) is not stated. (b) Deal `choices[]` have no `sort_order`, so they show in item-id order and the owner cannot put Naan before Roghni. | §4.6 lines 308, 351–356 | State "only groups referenced by an item in this snapshot". Add `sort_order` to choices, or state the order as `item_id`. |
| m6 | MINOR | §4.5 cost | The 01a test list misses #140 (snapshot "≤ 13 statements"; 01c adds 9 reads), #4 (snapshot contents), and #143 / #145 (day open/close with `BusinessDayOpened`). The list is also hedged "to be confirmed". | 01a tests 140, 4, 143, 145 | Add them, and remove the hedge before approval. |
| m7 | MINOR | V12, A2 | The tracked rule is **changed**, not "re-stated": a stock time alone no longer tracks an item, it also needs a draw. Every pre-cooked item now needs a stock item, a branch row and a draw (three forms). | V12 line 91; `packages/events/src/config.ts:112` | Name it as a change in A2. State the owner set-up cost in §8, or let the item form create a same-named stock item. |
| m8 | MINOR | V3 | `stock_items.kind` has one allowed value (`'prepared'`) and exists only for R28. CLAUDE.md: "No extra … 'for later'". | §5.1 line 385 | Drop the column (R28 adds it), or record the reason as a named exception. |
| m9 | MINOR | V17, §6.22 | No story AC or G3 answer asks for a deal On/Off toggle. Part unavailability is already covered by `isDealOrderable`, and a deal can be withdrawn per branch through §6.16. The toggle adds a command, 2 events, a hub migration, catch-up and query changes, and a client tab. | §1 stories table; §12.5 | Get an owner answer that justifies it, or move it to §12.4. |
| m10 | MINOR | §10 | Missing tests: §6.5 R1 on PATCH (only POST is tested); §6.12 "body only `expected_version`" (C9), which has no edge row and no test; effective-set order (group `sort_order`, then id); a hub upgraded while a **v1 day is open** (upcast `draws` used by the stock query and `canServeFromStock`); M1, M3, M4, M5, B2. | §10.2–10.8a | Add them. |
| m11 | MINOR | V11 e vs V16 | Removing a route (01a §6.16) silently drops a deal whose part had only that choice, and a linked option. V16 refuses archive precisely because "a deal that silently disappears … is worse". | V16 line 95; V11 e | Warn on the owner pages, at least: "Not sold at X: part N has no routed choice". |
| m12 | MINOR | §4.3 | No `category_id` copy, so 05's Z report or 07's by-category view would rely on today's category (a variant group move rewrites history). 07's Σ `allocated_price_minor` ≠ the deal `line_total_minor` by the part option charges. | §4.3; §4.4 07 row | Add `category_id` (the deal's for `deal` / `deal_part`), or state that 07 reads it from cloud config at report time. Say where part option charges count in 07. |
| m13 | MINOR | AU-2 | The service name check must use the same case fold as the other `lower(name)` indexes. JS `toLowerCase` and Postgres `lower()` differ for some scripts. | V14 line 93; §5.1 line 428 | Do the comparison in SQL with `lower()` under the lock, or name the fold. |
| m14 | MINOR | V20, §4.2 `dayDraws` | The fallback for an item not frozen at day open (tracked mid-day) is not stated. 01a's `dayUnits` falls back to config (`packages/engine/src/stock.ts:19–27`). If the pot's `stock_unit` also changed mid-day, the live draw factor is mixed with the frozen stock unit. | V20 line 99 | State the fallback, and that a draw whose stock item's frozen unit differs from the config unit is not used that day. |
| m15 | MINOR | §3.3 links, §6.12 | Links are sent whole and re-checked as "active target". A target archived since the last save (a category with no items) then blocks every group save until the owner removes the link. Separately, V16's "active option links the item" should exclude options of archived groups. | §3.3 line 121; §6.5 R4 | Re-check only links that were added or changed; ignore archived targets in the builder. Scope R4 to active groups. |
| m16 | MINOR | V11 d | `isDealOrderable` takes no quantity. A `sold_out` naan with 2 left passes for a part that needs 4 × deal qty. | §4.2 line 170 | Pass the line's part quantity, or state that 03a's reservation refusal is the check. |

---

## What I tried to break and could not

- **Allocation arithmetic:** §4.3 example (E1), tests 5–7 (zero weights, all-zero split, remainder to the last part) and tests 1–4, 9, 10, 87, 89 all check out by hand. `lineTotalMinor` is BigInt-safe, and g/ml weights use its S59 rupee rounding, so the order line and the bill agree.
- **Tax only from the deal line:** `deal_part` has `line_total_minor` 0 and copies the deal's `tax_class_id`. An option child is taxed on its own line. I found no path that taxes `allocated_price_minor`.
- **AU-2 is race-safe.** Every write to `modifier_options` happens inside a group-row `FOR UPDATE` (POST rows are invisible until commit), at READ COMMITTED. Cloud writes use the default level; only the read-only config build uses REPEATABLE READ (`config-sync/service.ts:84`). The group version also covers `options`, so two concurrent PATCHes already collide on `409`. The rename-swap reason holds, because a non-deferrable unique index checks each row as it is written. The upsert keeps `modifier_option_branches` FKs; foreign ids are refused before the upsert, so `ON CONFLICT` can never claim another group's option.
- **Upcasters and boot fold:** `parseEvent` chains `upcastFromPrevious` (`packages/events/src/codecs.ts:15–21`). The boot fold calls `parseEvent` on every row (`apps/hub/src/sync/boot-steps.ts:41–44`). `BusinessDayOpened` v1 `units` (`BusinessDayOpened.v1.ts`) maps one-to-one to `stock_units` + `draws`. Same-ULID stream ids make v1 then v2 `StockSet` fold into one entry (test 67). `DealMade*` on stream `stock` passes harmlessly through the fold's default branch. `ENGINE_STATE_VERSION` is not read by the hub (no persisted engine snapshot yet), so the bump is safe.
- **Backfill SQL:** `item_routes` has PK `(tenant, branch, item)`, so there is one `stock_item_branches` row per tracked route and no PK clash. Active `menu_items` names are unique, so `stock_items` names are unique. The 01a CHECK (`0002_restaurant_setup.sql:112–114`) guarantees that the copied `stock_per_sale_unit` is non-null and satisfies the V4 unit rule. The rule needs a join to `stations.station_type`, because `stock_time_ms` is tenant-level and `stock_program_id` is per route; the spec's wording allows this.
- **V16 archive vs reference races** (item, stock item, station, category, tax class, variant group, deal) are serialised by `FOR UPDATE` against `FOR SHARE` under READ COMMITTED. Test 74's claim holds.
- **R6/R8 (item side) against deal writes:** item `FOR UPDATE` serialises against the deal's `FOR SHARE` on choice items, and the in-use read runs after the lock.
- **§6.12a vs §6.12 option archive (test 91)** behaves as written. AU-1's two CHECKs allow exactly `(false, null)` and `(true, X)`. AU-3 to AU-6 are reasonable and named.
- **Audit CHECK widening** keeps every value from `0005_staff_roles.sql:120–127`.
- **Every file in the §4.5 cost list exists.** The 01a admin schemas are not `.strict()`, so removed fields are dropped as claimed. The hub's next migration number is 0006.
- **Snapshot builder:** 9 added fixed reads, with the effective set and F1 resolved in memory. No N+1. Endpoint count: 15 own routes.
- **Named overrides:** F §4.7, F §5.9 step 5, 01a S23, S28 c, S59, §6.9/12/13/15, E1-ROUTE AC1 and C5 are all named. The only unnamed one I found is B1.

## Verdict

**CHANGES REQUIRED** — 2 BLOCKER (B1, B2) and 9 MAJOR (M1–M9). Fix them in v0.3, then re-run G4 on the changed sections.

---

# Run 2 — v0.3

Target: `docs/specs/01c_Menu_Variants_Spec_v0.3.md` (commit fa7644e). Fresh session, 2026-10-29. I checked each finding against the section text and the named test, not the changelog. The code checks were against `apps/cloud/src/modules/restaurant/{service,repository}.ts`, `packages/events/src/{config,admin/restaurant}.ts`, `packages/engine/src/stock.ts`, the hub files in the §4.5 cost list, and 01a v1.3.1 §10. The spec was not edited.

**Verdict: CHANGES REQUIRED** — 0 BLOCKER, 1 MAJOR (N1), 8 MINOR (N2–N9). Of the run-1 findings, 25 are closed and 2 are partly closed (M8 → N1, m1 → N4).

## Hand checks

| Test | Hand result | Spec | Match |
|---|---|---|---|
| 8 | Weights 220 000 / 12 000 / 75 000 (Σ 307 000) → 229 315 / 12 508 / 78 177. Roghni ×4: extra 3 000 × 4 × 1 = 12 000, so 24 508 | same | yes |
| 94 | 150 000 × 2 = 300 000; extra on a g/ml part 50 000 × deal qty 2 = 100 000; total **400 000**. Piece part: 3 000 × 4 × 2 = 24 000 | same | yes (E3 fixed) |
| 95 | `optionChargeMinor(8000, 1, 2, 'piece')` = 16 000; at deal qty 1 it is 8 000 | same | yes |
| 102 | ⌊78 177 / 2⌋ = 39 088, remainder 39 089; 12 508 / 4 = 3 127 × 4 | same | yes |
| 103 | Weights 220 000 / 24 000 / 75 000 (Σ 319 000) → 220 689 / 24 075 / 75 236. This is the failing output of an implementation that weights by the chosen item | same | yes |
| 104 | `allocateDealMinor(1e12, [1e15, 1])` = [999 999 999 999, 1]. **Plain `Number` arithmetic gives the same answer**, so the test does not tell BigInt from Number (N4) | no expected value stated | weak |

## Closure table (run-1 findings)

| # | Status | Evidence |
|---|---|---|
| B1 | CLOSED | §4.3 adds `program_cook_time_ms` and `stock_program_cook_time_ms`. A6 keeps the 01a copy. §4.4 has 02 and 03a rows. Test 93 checks that the snapshot `programs[]` carries `cook_time_ms` and archived programs, which matches `packages/events/src/config.ts:52–58`. The `ItemAdded` assertion is carried to 02's tests, which is right because 02 owns the schema |
| B2 | CLOSED | V11 a, §3.4.3 and §3.4.4 scale charges by deal quantity: a piece part is extra × part qty × deal qty, and a g/ml part is extra × deal qty. A plain option on a g/ml part takes parent qty = deal qty. Tests 94 and 95 match the hand results |
| M1 | CLOSED (residue N6) | V9, §3.4.6, `has_plain_options` (§4.6 rule 3), `isGroupSatisfiable` / `isItemOrderable` / `isDealOrderable` per position, test 96 |
| M2 | CLOSED (residue N5) | §3.4.6 has an `isAvailable(linked item, child qty)` input to `checkOptionChoices`, the §4.4 02 row covers it, and so does test 97 |
| M3 | CLOSED for the two-party case (residues N2, N3) | The §6 lock-order paragraph puts the group before the item. §6.5 reads unlocked, then takes the group `FOR SHARE`, then the item `FOR UPDATE`. §6.2 locks members in `item_id` order. Test 98. Today's code takes the item first (`service.ts:885`, `repository.ts:628` `lockMenuItem`), so this is a real script change, and the plan must say so |
| M4 | CLOSED | §6.9 and §6.16 lock the parent `FOR UPDATE`, as the §6 paragraph says. The edge rows and test 99 cover two first-time PUTs |
| M5 | CLOSED | V8 and §3.3 call the limit a "write-time soft limit". §4.6 rule 3 sets no maximum in `BranchConfigSnapshotSchemaV2` and says the builder does not truncate. Test 100 |
| M6 | CLOSED | §3.2.4, §6.2 (archived members move too), §6.5 R1 on restore, and R1a (the group must be active). Test 101 |
| M7 | CLOSED | §4.3 "Weight entered later" requires `{ order_item_id, quantity, line_total_minor }`, computed from the `ItemAdded` copy (D25) in S59 steps. The §4.4 02, 04, 05 and 07 rows read it |
| M8 | **PARTLY** → N1 | §3.4.8 and §4.4 04 define a per-unit split and the parent→child cascade. The cascade rule as written over-refunds after a partial void, and a "unit" of a g/ml part is not defined |
| M9 | CLOSED | V11 c weights by the reference choice. The test 8 fixture gives Roghni Rs 60. Test 103 fails a chosen-item implementation |
| m1 | **PARTLY** → N4 | §4.2 requires BigInt inside and a throw on a non-safe result, but test 104 does not discriminate |
| m2 | CLOSED | M9 removes the dependence on the chosen item |
| m3 | CLOSED | V14 and the §6.15 notes upsert parts, rewrite choices only, and keep FK order. Test 105 |
| m4 | CLOSED | §6.12a deletes only the rows of active options. Test 106 |
| m5 | CLOSED | §4.6 rule 3 keeps only referenced groups. `deal_part_choices.sort_order` is in the table, the wire, the version input and the snapshot. Test 107 |
| m6 | CLOSED | The §4.5 list has 4, 140, 143 and 145, checked against 01a §10: 140 says "≤ 13", and 13 + 9 = 22 as the spec states. The hedge is gone. 34 tests counted. (01a #128 has no build step, N7) |
| m7 | CLOSED (caveat below) | A2 names the tracked rule as a change. §8 adds the "Create a stock item with this name" flow |
| m8 | CLOSED | No `kind` remains in V3, §5.1, §5.4 or §4.6 |
| m9 | CLOSED | No dangling reference, see the regressions section |
| m10 | CLOSED | Tests 111–114 are added. M1/M3/M4/M5/B2 are covered by 96, 98, 99, 100, 94 and 95 |
| m11 | CLOSED (caveat below) | §8 "Omitted at a branch". Test 115 |
| m12 | CLOSED | §4.3 has `category_id` (the deal's on `deal` / `deal_part`). The §4.4 07 row says where part option charges count |
| m13 | CLOSED | One SQL `lower(name)` statement under the group lock (V14, §6.12 R4). Test 116 |
| m14 | CLOSED | V20 falls back to config, which matches 01a `dayUnits` (`packages/engine/src/stock.ts:19–27`). A draw whose stock item's frozen unit differs is dropped for the day. Test 108 |
| m15 | CLOSED | §6.12 re-checks only added or changed links. §4.6 rule 6, V16 and §6.5 R4 scope to active groups. Test 109 |
| m16 | CLOSED | V11 d and §4.2 pass part qty × deal qty. Test 110 |

## Author's calls AU-7 to AU-11

- **AU-7 `has_plain_options`: sound.** The snapshot is the only place 02 can tell "all linked" from "plain options configured but none offered here", because unoffered plain options are left out. The field depends on tenant config only, so it is the same on every branch. Residue: N6, a group that mixes plain and linked options.
- **AU-8 retired numbers: sound.** This matches 01a's convention (removed 55, 96–101, 104, 109, "Number not reused"). The DoD, §10.8 and §11 all skip 71 and 72.
- **AU-9 re-read and repeat once:**
  - *Can it loop?* No. The repeat is bounded at one, and the item `FOR UPDATE` is held during the repeat, so the stored `variant_group_id` cannot change again.
  - *Can it deadlock?* Yes. The repeat takes the new group's `FOR SHARE` while it holds the item `FOR UPDATE`. That is the item→group order M3 removed (N2).
  - *Can it miss a change?* Yes, on the path where both the stored and the merged group are null. That path never re-reads after the item lock (N2).
- **AU-10: sound.** `optionChargeMinor(price, q, dealQty, 'piece')` = price × q × dealQty, which is what B2 asked for (test 95). R28 depletion for such an option needs the parent `deal` line's quantity. That is derivable from the events, so it is not a finding.
- **AU-11 (first routed choice per branch): sound.** The weight is deterministic for a given snapshot, the hub and the clients use the same snapshot, and the result is copied at order time (D25). A route change moves the weight only for new orders. Unavailable but routed choices stay the reference, which is correct because only the price is used.

## Regressions from the v0.3 edits

- **Removed deal toggle:** `SetDealAvailability`, `DealMade*`, `deal_availability`, V17, §6.22 and tests 71/72 now appear only in the changelog, the V17 tombstone, the §6.22 tombstone, the §10.7 retirements, AU-8 and §12.4. Nothing in §4.2 catch-up, §4.5 A8 or the cost list, §5.2, §6.0, §6.21, §8 or §9 still uses them. `DEAL_NOT_FOUND` is now cloud-only.
- **Counts:**
  - Own routes: 14. Touched routes: 22, and §12.2 has 22 rows.
  - Tests: 1–116 minus 2 = 114.
  - §10.9: 15 rows, 15 covered.
  - §12.6: 16 writes listed.
  - 01a list: 34 entries.
  - Every 01c test 1–116 (except 71/72) has a §11 step.
- **§11 / §4.5 mismatch:** 01a #128 is in the §4.5 list but in no §11 step (33 of 34 assigned). §12.2 lists test 116 only under §6.12, not §6.11. Both are N7.

## New findings (run 2)

| # | Sev | Section | Finding | Evidence | Proposed fix |
|---|---|---|---|---|---|
| N1 | **MAJOR** | §3.4.8, §4.4 04 row | **The cascade rule over-refunds after a partial void.** "Voiding the deal voids every part and refunds the deal line total" ignores refunds already made. Example: family deal ×1; void 2 of the 4 naan → 3 127 + 3 127 = 6 254 refunded; then void the deal → 320 000 refunded. Total 326 254 on a 320 000 line. The same applies to "voiding a parent line voids its `option_child` lines, each refunded on its own" after a child unit was already voided. Two smaller gaps: (a) the shares are fixed only if the voided units take them in index order, because the remainder goes to the last unit; (b) a "unit" of a g/ml `deal_part` (quantity 1 000 g) is undefined, and `[1, …, 1]` over grams is meaningless | §3.4.8 line 206; §4.4 line 310 | A later void refunds the line's **remaining** refundable amount (refundable − refunds already made). Voided units take shares from index 0 upward. A g/ml part's units are its deals (deal qty shares). Add a test: a part unit void, then a deal void, sums to the deal line total |
| N2 | MINOR | §6 lock order (AU-9), §6.5 | (a) The repeat step locks the new group `FOR SHARE` while it holds the item `FOR UPDATE`. A §6.2 move of that new group (group `FOR UPDATE`, then members, including this item) gives 40P01. This needs a third write that moved the item between the unlocked read and the lock, so it is rare. The edge row "no deadlock" is still not true. (b) When the unlocked read has a null group and the body sends none, the script locks the item directly and never re-reads. A concurrent join to group G is then checked (R1) without G's lock | §6 line 622; §6.5 line 714, edge line 727; `service.ts:885` | Take a `SAVEPOINT` before the item lock. On a mismatch, `ROLLBACK TO SAVEPOINT` (this releases the item's row lock), lock the new group, and lock the item again. After a second mismatch, return `503`. Always compare the locked row's group with the groups held, including on the null path |
| N3 | MINOR | §6.11, §6.12 | The reference reads are listed as "linked items, categories, variant groups, items", which puts items before variant groups and contradicts the new §6 rule. A group POST whose option links member I of G and which links to G, running against a §6.2 move of G, deadlocks: the item is held in share mode and waits for G, while G is held for update and waits for I | §6.11 line 791; §6 line 622 | Lock order in §6.11 and §6.12: variant groups, then categories, then items (linked and target) in id order |
| N4 | MINOR | test 104, m1 | Test 104 passes with `Number` arithmetic (hand check above) and states no expected value | scratch check | Add `allocateDealMinor(95 921 642, [199 714 492 077 708, 199 714 492 077 708])` = `[47 960 821, 47 960 821]`. Float floor gives `[47 960 820, 47 960 822]` |
| N5 | MINOR | §3.4.6 (M2) | Selectability checks only `isAvailable` for the linked item, not that its groups are satisfiable in the child position. A linked Naan whose required plain group has `options: []` at the branch (F1) is shown as selectable, and then `SubmitOrder` refuses the order | §3.4.6 line 204; §4.2 | Selectable iff `isItemOrderable(linked item, …, 'child', child qty, isAvailable)` |
| N6 | MINOR | §3.4.6 vs V9 (M1) | V9 says "plain options configured but none offered"; §3.4.6 says "no option offered". A required group with its plain options unoffered at a branch but linked options offered falls between the two. The capacity rule of `isGroupSatisfiable(g, 'child')` is not stated. Cloud's `choices_unsatisfiable` counts linked options, so the owner can save a group (min 2: one plain option of max 1, plus one linked) that makes every attached item unorderable as a deal part, with no owner warning | V9 line 151; §3.4.6; §3.3 merged rules | Define `isGroupSatisfiable(g, 'child')` = `!has_plain_options` or `min_choices ≤ Σ max_quantity` of the **offered plain** options. Use the same wording in §3.4.6. Add the mixed case to test 96 |
| N7 | MINOR | §11, §12.2 | 01a #128 (units on the item) is in the §4.5 list but in no build step. Test 116 (POST case) is not listed under §6.11 | §4.5 line 368; §11 steps 5, 12, 14–16 | Assign #128 to step 8 (item form fields). Add 116 to the §6.11 row |
| N8 | MINOR | §6.5 restore (missed in run 1) | A stock item can be archived while its only drawer is archived, because §6.8 R2 counts active drawers. Restoring the item then brings back a draw to an archived stock item. §6.5 does not re-check the draw target on restore, and §4.6 does not say whether such a draw is "tracked" | §6.5 R1/R1a; §6.8 R2; §4.6 rule 4 | On restore, re-check the draw's stock item is active (`422 { field: 'stock_draws.0.stock_item_id', reason: 'archived' }`), or state that the builder drops draws to archived stock items |
| N9 | MINOR | §8 m7 flow | Retrying a §6.9 PUT whose response was lost sends the "no row" version again, so the owner's own retry gets `409 CONFIG_STALE` "Changed elsewhere". A retried §6.7 POST without the same `Idempotency-Key` gets `409 CONFIG_NAME_TAKEN` | §8 line 975; §6.9; §6.7 | The form keeps the POST's key for its retries and re-reads §6.6 before retrying the PUTs |

## The author's two caveats

- **m11 (warnings computed from paged menu reads): acceptable for the pilot. Yes.** The warning is advisory. The snapshot and the hub stay correct without it, because V11 e drops the deal and the order screen never offers it. The pilot has ~200 items and 3 branches, so a few `GET /v1/admin/menu` pages, and the menu response already carries `routes` per item (`packages/events/src/admin/restaurant.ts:290`). The page already loads those pages for its pickers. Condition: the warning is computed only after the last page (`next_cursor: null`), and the page shows "checking…" until then, so a partial load never shows a false "all sold".
- **m7 (three-call stock item creation, not atomic): acceptable for the pilot. Yes**, on the N9 condition. Each partial state is valid and visible:
  - A stock item with no branch rows is listed and can be archived, since it has no drawer.
  - Branch rows with no draw show "Not used by any dish here" (F4).
  - The item PATCH is last write wins and idempotent.

  It is a convenience flow for a handful of set-up actions. A server-side atomic endpoint would add a route for no pilot need.

## Verdict

**CHANGES REQUIRED** — 0 BLOCKER, **1 MAJOR open (N1)**, 8 MINOR (N2–N9). N1 is a one-paragraph fix to §3.4.8 and the §4.4 04 row, plus one test. I recommend the MINOR fixes in the same pass: N2/N3 (lock order), N4 (test vector) and N6 (definition) are each a line or two. After that, a run 3 limited to §3.4.6, §3.4.8, §4.4 04, §6 lock order, §6.5, §6.11/§6.12, §11 and tests 96/104 should be enough to approve.

---

# Run 3 — v0.4

Target: `docs/specs/01c_Menu_Variants_Spec_v0.4.md` (commit a9a2b4c). Narrow run in a fresh session, 2026-10-29. I checked each item against the section text and the named tests, not against the changelog or the self-check table. I re-ran the allocation numbers with BigInt and with float in Node. For the lock order, I checked the cloud code that 01c keeps: `lib/config-version.ts` (bump), `restaurant/service.ts` `putItemRoute`, and the FKs in `0002_restaurant_setup.sql`. The spec was not edited.

**Verdict: CHANGES REQUIRED** — 0 BLOCKER, **1 MAJOR (P1)**, 4 MINOR (P2–P5). N1–N9 are all closed, and so are M8 and m1. P1 was missed in runs 1 and 2. It came to light because N1 now defines an `option_child` unit as "one piece".

## Hand checks (N1, N4)

| Test | Hand result | Spec | Match |
|---|---|---|---|
| 117 | Naan part 12 508 over `[1,1,1,1]` = 3 127 × 4. Voiding 2 units refunds 6 254. Voiding the deal then refunds 320 000 − 6 254 = 313 746. Total 320 000 | same | yes |
| 118 | 300 000 over 220 000 / 12 000 → 284 482 / 15 518. Part A `allocated_price_minor` (extra included, §4.3) = 284 482 + 50 000 × 2 = 384 482, over 2 units (one per deal) → 192 241 / 192 241. Voiding the deal then refunds 400 000 − 384 482 = 15 518, which equals part B's refundable amount. Total 400 000 | same | yes |
| 118 identity | Σ part refundable = Σ allocated (extras included) + Σ part option charges = deal price × qty + extras + option charges = deal `line_total_minor` (§3.4.4). So "deal void = line total − refunds already made" can never go negative or exceed the line, in any void order | §3.4.8 | yes |
| Void order | Refundable 10 over 3 units → `[3, 3, 4]`. The first two units voided get 3 each and the last gets 4, in any order of physical units | §3.4.8 | yes |
| 104 | `allocateDealMinor(95 921 642, [w, w])`, w = 199 714 492 077 708. BigInt gives 47 960 821 / 47 960 821. Float `Math.floor(t·w/Σw)` gives 47 960 820, so the remainder is 47 960 822. The product t·w is not a safe integer | same | yes, and it now tells BigInt from float |

## Closure table

| # | Status | Evidence |
|---|---|---|
| N1 | CLOSED (residue P4) | §3.4.8 states:<br>• the refundable amount per line kind;<br>• units (a g/ml part is voided per deal, never per gram);<br>• void-order shares with the remainder on the last remaining unit;<br>• "remaining" on both cascades.<br>§4.4 04 carries the persisted per-line refunded amount and units voided by name. Tests 117–119 match the hand checks. The property test 119 asserts "≤ refundable after every step" and "= exactly once all are voided" |
| N2 | CLOSED | §6 restart rule:<br>• it compares the locked re-read with the unlocked read, null included;<br>• on a difference it rolls back and restarts, with at most 3 attempts and then `503`;<br>• the no-group path is covered.<br>"An item lock is never followed by a group lock" holds: a rollback releases the group `FOR SHARE` locks, and nothing is locked before the group. The §6.5 script and edge row match. Test 120 a–c covers both paths and the cap. AU-9 is marked superseded |
| N3 | CLOSED (residue P3) | The §6 table is one order of entity kinds. The §6.2 script locks the members before the category. §6.11 and §6.12 lock variant groups, then items, then categories. The §6.14 order is 4 → 6 → 7. Test 121 is the exact run-2 scenario |
| N4 | CLOSED | Test 104 replaced. The hand check above confirms it fails a float implementation |
| N5 | CLOSED (residue P2) | §3.4.6 makes a linked option selectable only through `isItemOrderable(…, 'child', child qty, isAvailable)`. The §4.2 signature gains `groupsById`. The §4.4 02 row matches. Test 122 uses the F1 case |
| N6 | CLOSED | V9 and §3.4.6 carry the same sentence, compared word for word. §4.2 defines `isGroupSatisfiable` for `'line'` and `'child'`. Test 96 adds three mixed-group cases, including min 2 where `'child'` is false and `'line'` is true |
| N7 | CLOSED | §11 step 8 re-keys 01a #128. §12.2 row 6.11 lists 116 |
| N8 | CLOSED | §3.3 row, §6.5 R9 (read under the stock item `FOR SHARE`) and the edge row. The race with a §6.8 archive is serialised: the archive takes `FOR UPDATE`, and its R2 is a read-committed read after the lock. Test 123 |
| N9 | CLOSED | §8 reuses the POST key and re-reads §6.6 before retrying, so PUTs that already succeeded are skipped. The m11 warnings show only after `next_cursor: null`, with "Checking branches…" until then. Tests 115 and 124 |
| M8 | CLOSED (via N1; residue P4) | — |
| m1 | CLOSED (via N4) | — |

## Lock order and the N2 restart rule

I checked each write in §6 against the table, pairing every write that takes `FOR UPDATE` with every write that later waits on a lock of the same kind:

- **§6.2 ‖ §6.5:** the group comes first on both sides. A §6.5 that moves an item into G (merged G) waits on G, so §6.2's member set (`WHERE variant_group_id = G`) cannot gain or lose a row while it runs.
- **§6.2 ‖ §6.11 / §6.12:** test 121.
- **§6.5 ‖ §6.12 / §6.15:** the item is `FOR UPDATE` on one side and `FOR SHARE` on the other. Neither side holds a later kind exclusively.
- **§6.5 ‖ §6.8:** the stock item is share-locked against an update-lock, and the in-use reads run after the lock.
- **§6.9 / §6.12a / §6.16 ‖ themselves:** parent `FOR UPDATE` (M4).
- **01a category, tax class and station archives:** one target lock, and the in-use checks are plain reads.

I found no cycle.

**Restart rule:**
- *Deadlock:* none. The only group→item edge is §6.5, and it never holds the item while it asks for a group.
- *Livelock:* bounded. Each restart needs another writer to commit a membership change in a window of a few milliseconds. Three attempts, then `503`.
- *Missed change:* none on `variant_group_id`. Category, draw and tax class are read from the locked row and locked after it, so they cannot go stale. The group's category is held by the group `FOR SHARE`.

Two leads I tested and dropped:

- **Implicit FK locks against the bump.** Tenant-wide bumps take `branches … ORDER BY branch_id FOR UPDATE` (`config-version.ts:37`), which conflicts with the `FOR KEY SHARE` that an insert takes on its FK parent. But no tenant-wide 01c write inserts a row with an FK to `branches`. `item_routes` references `stations`, not `branches` (`0002:147–150`). The branch PUTs bump with a plain `UPDATE`, which takes `FOR NO KEY UPDATE` and is compatible with `KEY SHARE`. So there is no cycle.
- **01a `putItemRoute`** locks item → route row → station (4 → 9 → 8). That is out of the table's order, but it is not a 01c write. Nothing else locks a station `FOR UPDATE` and then waits on an item route or an item, so it causes no cycle.

## Regressions from the v0.4 edits

- **Tests:** numbers 1–124 with 71 and 72 retired = 122, as the header states. There is no duplicate number. Every 01c test has a §11 step: I checked this by script over §11, with the 01a re-key lists stripped out. New tests in §12.2: 120 and 123 (6.5), 121 (6.2, 6.11), 124 (6.7). 117–119 and 122 are domain-only, in step 3. §10.9 has 15 rows, and all 15 are covered.
- **Cross-references:**
  - The §4.2 `checkOptionChoices` signature (with `groupsById`) matches §3.4.6 and the §4.4 02 row.
  - The §4.3 `allocated_price_minor` "extra included" is consistent with test 118.
  - AU-9 is marked superseded.
  - Endpoint counts are unchanged (14 own, 22 touched).
- **Self-check and notes drift:** see P5.

## New findings (run 3)

| # | Sev | Section | Finding | Evidence | Proposed fix |
|---|---|---|---|---|---|
| P1 | **MAJOR** | §3.3 options row, §6.5 merged rules, §3.4.4, §3.4.8 (missed in runs 1–2) | **A linked item can stop being `piece` after it is linked, and nothing refuses it or drops it.** `linked_item_not_piece` is checked only when the group is written (§6.11, §6.12). §6.5 has R6 for deal parts (D-3, "no silent drop") and R8 for weighing in deals, but nothing for an item that an active option links. Example: the owner changes Raita (linked, Rs 80/piece) to `g` at Rs 400/kg. The builder keeps the option, because §4.6 rule 2 drops only unoffered or unrouted options. 02 then bills the child as `lineTotalMinor(price, qty, 'piece')` (§3.4.4), which gives 3 "pieces" × 40 000 = Rs 1,200 instead of the configured charge. The N1 unit "one piece" and `childQuantity` stop meaning anything. Turning `requires_weighing` on for that item (R7 allows it for g/ml) makes a pending-weight child line, which no rule covers. The result is a wrong bill with no warning, which is the same class of fault that D-3 fixed for deals | §3.3 row "`linked_item_id` an active item whose `sale_unit = 'piece'`"; §6.5 R6, R8 (deals only); §4.6 rule 2; §3.4.4 `option_child` total | Add a §6.5 merged rule **R10**: a `sale_unit` change away from `piece`, or `requires_weighing` turned on, while an active option of an active group links the item → `409 CONFIG_IN_USE { used_by: { entity: 'modifier_group', ids } }` (01a S22 pattern, the same read as R4). §6.12 already locks linked items `FOR SHARE`, so the race is covered by §6.5's item `FOR UPDATE`. Add a test: PATCH linked Naan `sale_unit: 'g'` → `409`; with the option archived → `200` |
| P2 | MINOR | §4.2 `isGroupSatisfiable(g, 'line')`, §3.4.6 (residue of M1, M2, N5) | `'line'` satisfiability counts every option at the branch, including linked options whose item is sold out or 86'd. N5 makes those options not selectable. Example: Karahi has a required "Bread" (min 1) whose only option is linked Naan, and Naan is sold out. `isItemOrderable(Karahi, 'line')` is true, so Karahi shows as orderable, but every `SubmitOrder` is refused and the sheet shows Bread with nothing to pick | §4.2 row (line 267); §3.4.6 | In the `'line'` position, count a linked option toward Σ `max_quantity` only when `isItemOrderable(linked item, …, 'child', 1, isAvailable)`. Add a case to test 122 |
| P3 | MINOR | §6 table vs §6.9 script | The table's check says "§6.9 (5 → 8 → 9)", but the §6.9 script locks the `stock_item_branches` row `FOR UPDATE` **before** the station `FOR SHARE` (5 → 9 → 8). That breaks "never locks an earlier kind after a later one". No cycle exists today: only §6.9 locks that row, and only under the stock item `FOR UPDATE`. But the table's per-write claim is false, and an implementer has two texts to choose from | §6.9 script (line 819); §6 "Checked per write" (line 669) | Either lock the station before the branch row (C4 lets the version compare read the row without a lock, because the parent `FOR UPDATE` already serialises it), or record §6.9 as 5 → 9 → 8 with that reason |
| P4 | MINOR | §3.4.8 cascades (residue of N1) | Only a **whole** parent void cascades. Partially voiding an `item` line with piece `option_child` lines is undefined: void 1 of 2 karahis with 3 naan each (child line 6 naan). Should 3 naan be voided and refunded, or none? `childQuantity` ties the child quantity to the parent quantity, so the rule belongs to 01c, and 04 must not guess | §3.4.2, §3.4.8 | State one of these: (a) a partial void of a `piece` parent voids `optQty × voided units` of each child, with each child refunded by its void-order shares; or (b) children are not touched and are voided on their own. A g/ml parent is voided whole. Carry the choice to the §4.4 04 row and add it to test 119's generator |
| P5 | MINOR | header self-check, §12.6, version row | Traceability drift from the v0.4 edits:<br>• The self-check says N3 is fixed in "§6.4", but the §6.4 text is unchanged (its order lives only in the table), and it omits §6.14, whose script did change.<br>• The §12.6 "Hostile self-review notes" row was edited in v0.4 but still says "Author's calls AU-1–AU-6" (§12.3 has AU-1–AU-11, with AU-9 superseded).<br>• The version row's "changed sections" list omits V9, §3.3, §4.2, §4.4 02 and §6.14 | header self-check; §12.6 last row; §1 version row | Fix the three texts |

## Verdict

**CHANGES REQUIRED** — 0 BLOCKER, **1 MAJOR (P1)**, 4 MINOR (P2–P5).

All nine run-2 findings and the two PARTLY items (M8, m1) are closed. The lock order and the restart rule hold: I found no deadlock, livelock or missed change. P1 is a single merged rule in §6.5 (R10), plus one §3.3 row and one test. P2–P5 are each a sentence or two. After those fixes, a run 4 limited to §6.5 R10, §4.2 `isGroupSatisfiable`, §3.4.8 and §6.9 should be enough to approve.

---

# Run 4 — v0.5

Target: `docs/specs/01c_Menu_Variants_Spec_v0.5.md` (commit aa534aa). Narrow run in a fresh session, 2026-10-29. I checked each item against the section text and the named tests, not the changelog or the self-check table. I re-ran the §3.4.8 void rules in Node with BigInt `allocateDealMinor` (test 126, its variant, and a 20 000-case property run with partial parent voids, child-unit voids and whole voids mixed). For the lock order I checked the code: `apps/cloud/src/lib/config-version.ts` (bump), and `restaurant/service.ts` `createMenuItem` / `patchMenuItem` and `assertRoutes`, plus `repository.ts` `shareCategory`, `shareTaxClass`, `shareStationsById` and `shareProgramsById`. The spec was not edited.

**Verdict: CHANGES REQUIRED** — 0 BLOCKER, **1 MAJOR (Q1)**, 3 MINOR (Q2–Q4). P2–P5 are closed. P1 is closed for the item side, but its v0.5 carve-out (R10 ignores options of archived groups) opens a restore path that the spec never re-checks (Q1).

## Hand checks

| Case | Hand result | Spec | Match |
|---|---|---|---|
| §3.4.8 example / test 126 main | Karahi × 2, Naan option qty 3 → child line 6 naan, 18 000. `allocateDealMinor(18 000, [1×6])` = 3 000 × 6. Void karahi 1 → 3 units → 9 000; void karahi 2 → last parent unit → every remaining child unit → 9 000. Σ 18 000 | same | yes |
| Test 126 variant | 2 naan voided alone → 6 000; karahi 1 → 3 more naan → 9 000; karahi 2 → 1 naan left (`min(k × optQty, remaining)`) → 3 000. Σ 18 000, 6 units | same | yes |
| Shares that do not divide evenly | Child refundable 10 over 6 units → `[1,1,1,1,1,5]`; void 1 of 2 parents → 3; then the rest → 7. Σ 10 | §3.4.8 | yes |
| Test 119 invariant (P4 generator) | 20 000 random piece parents (1–6 units, optQty 1–4) and children, random interleaving of k-of-n parent voids, child-unit voids and whole voids: **0** cases with refunds > refundable after any step; every line refunds exactly its refundable amount once fully voided. "Parent + children ≤ Σ refundable" follows from per-line ≤. The deal-side identity (run 3) is unchanged | §10.8c 119 | yes |
| Test 122 P2 extension | Bread min 1, options linked Naan, Roghni (max 1 each), both sold out → Σ counted = 0 < 1 → `'line'` false → Karahi not orderable. Roghni back → 1 ≥ 1 → true. Add a plain option, both breads sold out → plain counts → true. Recursion: `'line'` → `isItemOrderable(…, 'child', 1)` → `'child'` never looks at linked options, so depth 1 and it terminates | same | yes |

## Closure table (run-3 findings)

| # | Status | Evidence |
|---|---|---|
| P1 | **PARTLY** → Q1 | **What holds:**<br>• R10 is in §6.5 with the 01a S22 shape, which matches `service.ts:211/437/630/733` `{ entity, id, used_by: { entity, ids } }`.<br>• The §3.3 row, the two §6.5 edge rows, §9 (`used_by.entity: modifier_group`, R10) and test 125 are present.<br>• The race claim holds: §6.11 / §6.12 lock linked items `FOR SHARE` against R10's item `FOR UPDATE`, and a §6.12 that waits re-reads the row as `g` under READ COMMITTED → `422 linked_item_not_piece`.<br>• An archived option restored through §6.12 is re-checked, because `options` is sent whole and every sent linked item is a checked reference.<br>**What does not:** a **group** restore re-checks nothing (Q1) |
| P2 | CLOSED (residue Q3) | §3.4.6 "Groups in the line position", the §4.2 `isGroupSatisfiable` row and the §4.4 02 row say the same thing. The §4.4 row is a narrower example of the §3.4.6 rule, not a contradiction. Test 122 matches the hand check. Deal parts are in the child position, so P2 does not touch `isDealOrderable` |
| P3 | CLOSED | **§6.9:** the script now runs stock item `FOR UPDATE` → unlocked row read → station `FOR SHARE` → upsert (5 → 8 → 9).<br>**Unlocked branch-row read (row 9):** the only writer of `stock_item_branches` is §6.9, and the only writer of `deal_branches` is §6.16, each under its parent `FOR UPDATE`. §6.12a deletes `modifier_option_branches` only under the group lock, and the §6.12 option archive leaves those rows alone.<br>**Station archive ‖ §6.9:** serialised on the station row; the in-use read runs after the archive's lock.<br>**Row 10 against `config-version.ts`:** tenant-wide is `SELECT … ORDER BY branch_id FOR UPDATE` and branch-scope is a plain `UPDATE`, as stated. The bump is the last statement before `COMMIT` in every script, so no write waits on anything while it holds a `branches` lock.<br>**§6.4 and §6.5 against code:** `createMenuItem` locks category → tax class → stations → programs, then inserts the item and routes (6 → 7 → 8 → 9), and §6.4 adds 3 and 5 in front. `patchMenuItem` runs item `FOR UPDATE` → category → tax class → routes' stations / programs on restore (4 → 6 → 7 → 8), as stated.<br>**Scripts against the per-write list:** §6.8, §6.15 and §6.16 match. I found no cycle |
| P4 | CLOSED (residue Q4) | §3.4.8 defines an `item` line's refundable amount and units, the partial-void rule with the "fewer remain" clamp, the last-unit sweep and g/ml whole-only. The §4.4 04 row matches. Tests 119 and 126 match the hand checks above |
| P5 | CLOSED | Header row N3 now names §6.14, not §6.4. §12.6 reads "AU-1–AU-11 (AU-9 superseded)" and "6.5 R1–R10". I mapped every v0.3 → v0.4 diff hunk to its section by script, and the v0.4 list covers all of them except §12.1 (the DoD test range). That is editorial and not raised |

## Changed sections: regressions and counts

- **Tests:** 1–126 are defined once each. 71 and 72 are retired, so 124 live, as the header states. Every live test has a §11 step: 125 is in step 8 and 126 in step 3. §12.2 row 6.5 lists 125. 119, 122 and 126 are domain-only. §10.9 has 15 rows, all covered, and the G4 row adds 126. §12.1 reads 1–126.
- **Cross-references:** the §9 `CONFIG_IN_USE` note, §3.3 and §6.5 R10 agree on the shape. The §6 table's "R4, R6, R8, R10 of §6.5; R2 of §6.8 are plain reads" matches each script. Endpoint counts are unchanged (14 own, 22 touched).
- **Not re-opened:** nothing closed in runs 1–3 was broken by the v0.5 edits. The only regression-like item, Q1, comes from the new R10 carve-out.

## New findings (run 4)

| # | Sev | Section | Finding | Evidence | Proposed fix |
|---|---|---|---|---|---|
| Q1 | **MAJOR** | §6.5 R10, §6.12, §4.6 rule 2 | **Restoring a modifier group brings back a linked option to a non-`piece` item, and nothing refuses it or drops it, so the P1 wrong bill returns.** R10 counts only options of **active** groups, and test 125 asserts that the change is `200` while the group is archived. A later §6.12 `{ expected_version, archived: false }` sends no `options`, so no linked item is a checked reference (C4 step 4 checks the sent body only). §6.12's merged rules R1–R5 do not look at linked items, and builder rule 2 drops only unoffered or unrouted linked options. Sequence: archive "Bread" → PATCH Naan `sale_unit: 'g'`, Rs 400/kg (`200`, R10 by design) → restore "Bread" (`200`) → Naan is offered as a linked option again and 02 bills it as `lineTotalMinor(price, qty, 'piece')`, 3 "pieces" × 40 000. The same path restores a link to an item made weighed or archived while the group was archived. Deals do not have this gap: §6.15 R2 and R5 re-run on the merged parts on every PATCH, restore included | §6.5 R10 "active option of an active group"; test 125 last clause; §6.12 script and R1–R5; §4.6 rule 2; contrast §6.15 R2/R5 | Add a §6.12 merged rule **R6**: when the merged group is active (on restore, and on any PATCH that sends `options`), every active option's linked item is active, `sale_unit = 'piece'` and not `requires_weighing`, read under the linked items' `FOR SHARE` (kind 4, already in the §6.12 order) → `422 { field: 'options.N.linked_item_id', reason: 'linked_item_not_piece' \| 'archived' }`. Optionally add a builder backstop in rule 2: leave out a linked option whose item is not `piece` or is weighed. Extend test 125: archive Bread → Naan to `g` (`200`) → restore Bread → `422 linked_item_not_piece` |
| Q2 | MINOR | §6.5 R2, R6, R7, R8, R10; test 125 | **The precedence between merged rules that fire together is not stated, and test 125's expected `used_by` depends on it.** Test 8's fixture puts Naan and Roghni (both `piece`) in one deal part, and the R6 edge row uses exactly that Naan. A `sale_unit: 'g'` on that Naan trips both R6 (`409 used_by: deal`) and R10 (`409 used_by: modifier_group`). With `requires_weighing: true` it also trips R8 (`422 weighed_item_in_deal`), and with a draw it trips R2 / R7 (`422`). The only stated precedence is R4's "modifier groups reported first" | §6.5 edge rows (R6 row and R10 row both use Naan); test 8 fixture; test 125 | State one order for C4 step 6 in §6.5, e.g. 400s, then R10 before R6 / R8 (as R4), then the 422s. Or state that test 125's Naan has no draw and is in no deal part |
| Q3 | MINOR | §4.2 `isGroupSatisfiable` row (v0.5 P2) | **The `'line'` check cannot be computed from its stated parameters.** It must call `isItemOrderable(linked item, groupsById, 'child', 1, isAvailable)`, which needs the linked item's `modifier_group_ids`. But an option carries only `linked_item_id`, and `isGroupSatisfiable(group, position, groupsById, isAvailable)` has no `itemsById`. `checkOptionChoices` has the same gap. The two signatures also disagree: `isAvailable(itemId, quantity)` in the row's last sentence, and `isAvailable(item, quantity)` in `isItemOrderable`. `isDealOrderable` already takes `itemsById` | §4.2 `menu-lines.ts` row | Add `itemsById` to `isGroupSatisfiable` and `checkOptionChoices` (and to `isItemOrderable`, which calls them), and use one `isAvailable(itemId, quantity)` form |
| Q4 | MINOR | §3.4.8 partial void (v0.5 P4) vs §4.4 02 "Later additions" | **The per-parent-unit child quantity is undefined for a child added after the parent was placed, and its source is not named.** `ItemAdded` for an `option_child` carries the line `quantity`, not the option quantity per parent unit. 04 can derive `optQty` = child qty ÷ parent qty only for children placed with the parent. §4.4 02 allows a later child ("one more naan") as a new `ItemAdded` under the same parent. Example: Karahi × 2 with 3 naan each (6), plus 1 naan added later. When 1 karahi is voided, the rule gives no answer for the second child line (1 ÷ 2), and the parent has two child lines for one option | §3.4.8 "k × `optQty`"; §4.3 (no per-unit field); §4.4 02 "Later additions" | State that `optQty` = child `quantity` ÷ parent `quantity` for a child placed in the parent's `SubmitOrder`, and that a child added later is voided only by its own unit voids or when the last parent unit is voided. Or add `option_quantity` to `ItemAdded` for `option_child`. Add the case to test 126 |

## Verdict

**CHANGES REQUIRED** — 0 BLOCKER, **1 MAJOR (Q1)**, 3 MINOR (Q2–Q4).

P2, P3, P4 and P5 are closed, and P1 is closed on the item side. The P3 lock order matches both the scripts and the cloud code, and I found no cycle. The P4 void rules hold under a property run. Q1 is one §6.12 merged rule, plus an optional builder backstop and an extension to test 125. Q2–Q4 are each a sentence. After those fixes, a run 5 limited to §6.12 R6, the §6.5 rule precedence, the §4.2 signatures, §3.4.8 / §4.4 02 and tests 125 / 126 should be enough to approve.
