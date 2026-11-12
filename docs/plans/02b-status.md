# 02b status board

Plan: `docs/plans/02b-plan.md` (27 tasks; hub in **parallel waves 0–4**, prompts in `docs/plans/02b-parallel-prompts.md`; wave 5 = client, blocked on the design handoff). Spec: `docs/specs/02b_Ordering_Spec_v1.0.5.md` (APPROVED; v1.0.5 = AD-36: SubmitOrder's take-order scope follows 02a `requireLock`, owner 2026-11-11; v1.0.4 = the build rulings AD-8–AD-39 text bump, owner 2026-11-11; v1.0.3 = AD-11, owner 2026-11-10), on top of `main` `67c84c6` (02a hub merged, v1.1.4). Branch: `module-02b`.

> **Short Hinglish summary**
>
> **2026-11-10:** 02b ka plan likh diya, code abhi zero.
> - Hub: 24 tasks, 5 waves (0–4). Client: 3 tasks, design handoff ka intezaar.
> - G-1, G-2, G-3, G-7 ka faisla ho gaya (neeche). 02a `main` mein merge, `module-02b` `main` se dobara bana.
> - Agla qadam: wave 0.
>
> **2026-11-10 (wave 0):** tasks 1–5 ban gaye, gate green (3807 tests).
> - Task 4 ke review mein 3 contract signatures ghalat nikle (AD-8, AD-9, AD-10). Token string hai jabke spec INTEGER kehta hai (AD-7).
> - Wave 1 se pehle owner ka faisla chahiye: AD-7, AD-8, AD-10 (aur AD-9 wave 2 se pehle).
>
> **2026-11-10 (owner ke faisle):** AD-7 ke liye schema sakht kar diya; AD-8, AD-9, AD-10 contracts mein aa gaye; AD-11 ke liye spec v1.0.3 approve hui aur code theek ho gaya. Gate green (3812).
> - Review mein 2 aur khaliyan mili: AD-12 (hub ka UTC offset) aur AD-13 (serve ne kaun si lines serve kin). Wave 1 se pehle in par faisla chahiye.
>
> **2026-11-11 (wave 1):** projection, exports, ledger, food rules, buildSubmit ban gaye. Gate green (3909 tests).
> - Lane 1A aur 1C ruke, owner ne faisle diye (AD-14 se AD-22). AD-23 (fixture ka deal weight) abhi khula hai, kuch nahi rokta.
> - Agla qadam: wave 2.
>
> **2026-11-11 (wave 2):** saare 10 commands ban gaye (submit, remove, weight, comp, served, release/boost, return, zone stock). Gate green (4106 tests).
> - Lanes 4 dafa ruke, owner ne faisle diye (AD-24 se AD-35). AD-36 (lanes ki readings ka bundle) khula hai, kuch nahi rokta.
> - Agla qadam: wave 3.
>
> **2026-11-11 (wave 3):** queries, catch-up, audiences, queued replays aur handover ka amount ban gaye. Gate green (4135 tests). Saari 19 §12.2 rows ho gayin.
> - Agla qadam: wave 4 (perf file, acceptance map, spec v1.0.4).
>
> **2026-11-11 (wave 4):** perf file likh di (chalai nahi), acceptance map ban gaya, spec v1.0.4 aa gayi. Gate green.
> - 2 hub gaps: #29 (merge ke baad follow_up) aur 00 ka missed-pong test. Client ke 15 gaps wave 5 mein.
> - Owner: `pnpm test:perf` khud chalaayein, real disk par, akele.
>
> **2026-11-11 (build review):** review ke 5 gaps owner ke faislon se band (G-1 code fix, AD-40, #29 test, AD-36 → spec v1.0.5, 00 test). Gate green (4142). Verdict: ready to merge. Client (wave 5) aur test:perf abhi baaqi.

## Task table

| # | Task | §11 step | Wave / lane | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| 1 | §9 error codes | 1 | 0 | NORMAL | **done (wave 0)** | `f024331` |
| 2 | `OrderContactSet`, `OrdersBilled`, `ZoneStockAdded`, `ZoneStockSet` | 2 | 0 | NORMAL | **done (wave 0)** | `ed359f3` |
| 3 | Migration `0013_orders.sql` | 3 | 0 | HIGH | **done (wave 0)** | `8ec74c0` |
| 4 | `orders/contracts.ts`, `index.ts` skeleton, test fixtures | — | 0 | NORMAL | **done (wave 0); contract fix waits on AD-8–AD-10** | `c2a05b1` |
| 5 | Zone kinds, `zoneAlertDrafts` | 15 | 0 | NORMAL | **done (wave 0)** | `81b365a` |
| 6 | Projection `orders` | 3 | 1A | HIGH | **done (wave 1)** | `c1593fe`, `80206ab` |
| 7 | Exports `seatingTotals`, `orderLines`, `ordersOf` | 16 | 1A | NORMAL | **done (wave 1)** | `e44ee9d`, `a1933ef` |
| 8 | Ledger `lineShares`, cascades | 4 | 1B | HIGH | **done (wave 1)** | `48905b8`, `fd8433d` |
| 9 | Food rules `foodDrafts` | (9, 11, 13) | 1B | HIGH | **done (wave 1)** | `7fe766f`, `559cb2f` |
| 10 | `buildSubmit`, zone routing | 5 | 1C | NORMAL | **done (wave 1)** | `3109fe8`, `8b513ac`, `575af53` |
| 11 | `SubmitOrder` | 6 | 2A | HIGH | **done (wave 2)** | `89ece74`, `2ee6b18` |
| 12 | Zone-served submit | 7 | 2A | HIGH | **done (wave 2)** | `0cc7633` |
| 13 | `eta-preview` | 8 | 2A | NORMAL | **done (wave 2)** | `fd76194`, `5a39c29`, `c2e40fc` |
| 14 | `RemoveItems`, `lineChangeDrafts` | 9 | 2B | HIGH | **done (wave 2)** | `240a163`, `46e9528` |
| 15 | `SetLineWeight` | 10 | 2B | NORMAL | **done (wave 2)** | `46156a2`, `8c65d16` |
| 16 | `CompLine`, kind `comp` | 14 | 2B | HIGH | **done (wave 2)** | `7659232`, `2a7056d` |
| 17 | `MarkServed` | 11 | 2C | NORMAL | **done (wave 2)** | `80c07b5`, `193fa17`, `23af410` |
| 18 | `ReleaseItems`, `BoostOrder` | 12 | 2C | NORMAL | **done (wave 2)** | `9e5801c`, `420f3cd` |
| 19 | `ReturnToKitchen` | 13 | 2C | HIGH | **done (wave 2)** | `f725fb3`, `9645f4f`, `7831279` |
| 20 | `AddZoneStock`, `SetZoneStock` | 15 | 2D | NORMAL | **done (wave 2)** | `f3d3ccd` |
| 21 | Queries, catch-up, audiences | 17 | 3A | NORMAL | **done (wave 3)** | `ffdc43f`, `ce0410f`, `9e5d7ae` |
| 22 | Queued replays (02b's use) | 18 | 3B | HIGH | **done (wave 3)** | `39452dc`, `84859dc` |
| 23 | Handover card amount | — | 3C | NORMAL | **done (wave 3)** | `b3e984f` |
| 24 | Perf file, acceptance map, README rows | 22 | 4 | NORMAL | **done (wave 4); perf file not run (AD-4)** | |
| 25 | Client: queue and drafts | 19 | 5 | UI | **blocked (design handoff)** | |
| 26 | Client: ordering screen, options, preview | 20 | 5 | UI | **blocked (design handoff)** | |
| 27 | Client: table view orders, comp, zone stock, open orders, contact | 21 | 5 | UI | **blocked (design handoff)** | |

## G rows (gaps, owner ruling needed)

| # | Gap | Blocks | Options | Choice | Status |
|---|---|---|---|---|---|
| G-1 | Who wires `seatingTotals` into 02a's handover card (`amount`) | 23 | (a) 02a hook `registerSeatingTotals`, 02b registers it; (b) leave out until 05 | (a) 02a hook `registerSeatingTotals` | **ruled (owner, 2026-11-10)** |
| G-2 | Test-only edits to existing suites that list / count registered kinds, projections, audiences, commands, catch-up parts | none | (a) standing pre-approval, each noted in the wave entry; (b) STOP each time | (a) standing pre-approval, test-only, listed per wave | **ruled (owner, 2026-11-10)** |
| G-3 | `orders` projection registered in `lib/boot.ts` `createDeps` and `test/helpers/test-hub.ts` | 6 | (a) one append-only line + import each (02a SG-5) | (a) same as 02a SG-5 | **ruled (owner, 2026-11-10)** |
| G-7 | Base branch: merge `module-02a` into `main` first; re-cut `module-02b` from `main` or keep it on `module-02a` | wave 0 | owner | merged `67c84c6`; `module-02b` re-cut from `main` | **ruled (owner, 2026-11-10)** |

## AD rows

| # | Task | Reading | Status |
|---|---|---|---|
| AD-1 | 11, 22 | §3.2 `{ ...ctx, queued }` = 02a's `ctx.queuedAt !== null`; queued never takes or moves a lock (02a v1.1.3) | **ruled (owner, 2026-11-11): accepted as read** |
| AD-2 | 22, 24 | #31: 02b writes only its own clauses; 00 clauses map to 00 tests 152–158 | **ruled (owner, 2026-11-11): accepted as read** |
| AD-3 | 11, 17 | 02a #53 "order written" and 02a #62 are built here | **ruled (owner, 2026-11-11): accepted as read** |
| AD-4 | 24 | #34 perf file written, not run; owner runs `pnpm test:perf` | **ruled (owner, 2026-11-11): accepted as read** |
| AD-5 | — | 05 writes both `OrdersBilled` and `BillClosed`; note for 05 | **ruled (owner, 2026-11-11): accepted as read** |
| AD-6 | 2, 21 | zone events on stream `table`, id `zone:`; no 02a reader sees them | **ruled (owner, 2026-11-11): accepted as read** |
| AD-7 | 6, 11 | **Spec–code mismatch.** `OrderPlaced.token` is `z.string()` (02p `3db9ce1`), but 02b §5 has `token INTEGER` and §3.2 step 9 "1 + MAX(token)"; `car_type` is `z.string()` vs §5's CHECK. Options: (a) change the schema to `z.number().int()` / an enum (a Shared change, so do it before wave 1, as integrator fix commit); (b) keep string events; the projection stores `Number(token)` and `SubmitOrder` validates `car_type`. Recommendation: (b), because it changes no event schema that is already written; (a) only if the owner wants the event typed. | **ruled (owner, 2026-11-10): (a) tighten the schema** — `token` = `z.number().int().min(1).optional()`, `car_type` = `z.enum(['sedan','mini','large']).optional()`; `631b336` |
| AD-8 | 4 → 10, 11, 12 | **Contract.** `BuildSubmit(config, input)` can't do §3.2 step 4 (Off needs `item_availability`, out of hours needs hub `now`), `follow_up` (DB read), or routing by the seating's **primary** table (`seatingOf`). Zone candidates: does `proposed` include them or not (M-4 fallback)? Options: (a) add `ctx: { now; isAvailable; primary_table_id \| null; follow_up }`; `proposed` / `itemAdded` treat candidates as kitchen lines, and the caller drops the ones that pass the count and sets `served_from_zone_id`; (b) keep it as written, and lane 2A does those checks outside. Recommendation: (a). | **ruled (owner, 2026-11-10): (a)** — `f8b9e85`; amended by AD-12 (`876dfdc`) |
| AD-9 | 4 → 14 | **Contract.** `LineChangeDrafts(tx, …)` (§4.2 says `tx`) can't close stale comp requests with the caller's actor: `alerts.closeMany` needs an `AlertCtx`, and a bare `tx` forces `tickCtx` (actor null, device `hub`) into the audit log. Options: (a) `(ctx: CommandCtx, order_id, changes)` (ctx.tx is the tx; 02a `RequireLock` precedent), reading §4.2's `tx` as a name; (b) keep `tx`. Recommendation: (a). | **ruled (owner, 2026-11-10): (a)** — `f8b9e85` |
| AD-10 | 4 → 9 | **Contract.** `FoodDrafts` is pure but returns `EventDraft[]`, which needs `occurred_at` / `actor_id` / `device_id`. Options: (a) return envelope-less drafts `{ stream_type, stream_id, event_type, schema_version, payload }` (as engine `StockReservedDraft`, `ItemsReleasedDraft`), so the caller adds the envelope; doc says `lines` = the order's lines **after** the change; (b) keep it. Recommendation: (a). | **ruled (owner, 2026-11-10): (a)** — `f8b9e85`; amended by AD-13 (`876dfdc`) |
| AD-11 | 5, 20 | **Spec gap.** §3.10 closes `zone_stock_low` and `zone_stock_out` only when the count goes back **above** the threshold, so 0 → 1 (threshold 2) leaves `zone_stock_out` open. Built literally. Options: (a) keep it; (b) close `out` as soon as the count is > 0 (spec bump). | **ruled (owner, 2026-11-10): (b), spec v1.0.3 APPROVED** — `b9b3167`, `7273015`; code `602a7a4` |
| AD-12 | 4 → 10, 11, 13 | **Contract gap in the AD-8 ruling (fix B review, Critical).** S47 checks windows on **hub local time**. Both `isOrderableByTime(item, category, now, utc_offset_ms)` and `ITEM_OUT_OF_HOURS.opens_at_ms` need the hub's UTC offset. `BranchConfig` has no offset field, and `availability-windows.ts` says "never read from the runtime". The hub gets the offset from `hubTime(clock) → { now_ms, utc_offset_ms }`. Options: (a) add `utc_offset_ms: number` to `BuildSubmitCtx` (the caller passes `hubTime`); (b) replace `now` with `time: { now_ms; utc_offset_ms }` (the `hubTime` shape). Recommendation: (a). | **ruled (owner, 2026-11-10): (a)** — `utc_offset_ms` from `hubTime()`, never the runtime timezone; `876dfdc` |
| AD-13 | 4 → 9, 17, 19 | **Contract gap in the AD-10 ruling (fix B review, Important).** §3.7 says `OrderFoodServed` follows "every `ItemServed` that serves at least one food line". `FoodDrafts(order_id, lines, 'served')` gets only the lines after the change, so it can't tell which lines this `ItemServed` served. A failing case: a karahi is returned and its replacement is cooking, then a water is tap-served. The old karahi still has `served_at`, so the function would emit `OrderFoodServed` and the table would go green too early. Options: (a) `after: { kind: 'served'; order_item_ids: readonly string[] } \| 'change' \| 'return'`; (b) add a 4th parameter `served_ids`; (c) keep it, with a doc line. Recommendation: (a). | **ruled (owner, 2026-11-10): (a)** — `OrderFoodServed` only when the served ids include a food line (§3.3); `876dfdc` |
| AD-14 | 9 | `OrderFoodCleared.food_served` counts served food lines with no live filter: a void after the serve still gives `true` (task 9 review Important #1; spec silent; built literally) | **ruled (owner, 2026-11-11): keep as built** (text bump) |
| AD-15 | 6, 19 | Lane 1A STOP: `order_lines.return_of` has no event the projection may fold (`OrderLinesAdded` Fold "—"; `ItemReturned` remake only). Engine order is `OrderLinesAdded` → `ItemAdded` (03a placeholders), so an UPDATE at `OrderLinesAdded` finds no row | **ruled (owner, 2026-11-11): (A)** optional `return_of: string` on `ItemAdded` v1 (additive); task 19 writes it, the projection folds it from `ItemAdded`; `a3399b2` (also a types-only `Omit<ItemAddedPayload, 'return_of'>` in engine `plan.ts` `ProposedLine` for the name clash; opus review: behaviour-neutral) |
| AD-16 | 10, 11 | Lane 1C S-1: line `stock_draws` must be the day-frozen draws (01c V20, `dayDraws`); `BuildSubmitCtx` had no state | **ruled (owner, 2026-11-11): (a)** `BuildSubmitCtx.draws` resolver (item_id → `dayDraws`); `5d2773e` |
| AD-17 | 10, 14 | Lane 1C S-2: 02b says `422 VALIDATION_FAILED` (§4.4, §10 #1, §3.4, §3.5); foundation §6.2 / `errors.ts` = 400 | **ruled (owner, 2026-11-11): (a) keep 400** (foundation wins; text bump) |
| AD-18 | 10 | Lane 1C S-3: §6.1 `variant_id` has no meaning (01c V2: a variant is its own item) | **ruled (owner, 2026-11-11): (a) accepted and ignored** (text bump) |
| AD-19 | 10 | Lane 1C S-4: a deal outside its windows | **ruled (owner, 2026-11-11): (a)** `ITEM_OUT_OF_HOURS { deal_id, opens_at_ms }` (text bump) |
| AD-20 | 10 | Lane 1C S-5: a `kitchen_note` on a deal line lands on the header, which no slip shows | **ruled (owner, 2026-11-11): (b)** copied to every engine part (text bump) |
| AD-21 | 10, 11 | Lane 1C readings (task 10 review leftovers): deal parts in snapshot order, not `sort_order`; a weighed `from_zone` candidate cannot occur (01a A-1: zone stock items are piece); `isAvailable` = manual Off only, task 11 must not fold sold out into it; `order_note` of #2 tested in task 11 | **ruled (owner, 2026-11-11): accepted**; plan patch on task 11 |
| AD-22 | 9 | `isEngineLine` is not exported from `@pos/engine` (plan "Exact names" row wrong); task 9 copied it in `food.ts` | **ruled (owner, 2026-11-11):** re-export from `packages/engine/src/index.ts`, `food.ts` imports it (fix commit, opus review) |
| AD-23 | fixtures (test-only) | `appendOrder` weights deal parts by `lineTotalMinor(chosen price, qty, 'piece')`. 01c V11 c / M9 weight by the g/ml line total of the **reference** choice (first by `sort_order`, then `item_id`). No current assertion depends on it: every deal in use has piece parts and one choice each, and the new G3 test does not assert `allocated_price_minor` (fix G review). Options: (a) fix the fixture to the 01c rule (test-only); (b) leave it and document it. Recommendation: (a). | **ruled (owner, 2026-11-11): (a)** — test-only, with a two-choice g/ml deal `allocated_price_minor` test; `6e7bc46` (opus review approved; the fixture still writes deal-part `extra_price_minor` 0, so lanes must not seed extras through it) |
| AD-24 | 20, 21 | Lane 2D STOP: the "order taker receives `ZoneStockAdded`" clause needs the zone audience, which is task 21's (`orders/audiences.ts`); `audienceAllows` is false for an unregistered type | **ruled (owner, 2026-11-11): (a)** — clause moves to task 21 (plan patch); task 20 asserts `403` for an order taker without `manage-zone-stock` |
| AD-25 | 20 | §6.9 "1 branch stock read" = the in-memory engine state (`dayDraws` / `saleUnitsAvailable` on `ctx.state`), 0 SQL statements | **ruled (owner, 2026-11-11): accepted** (text bump: say "in memory") |
| AD-26 | 13 | Lane 2A STOP: the ≤ 8 KB eta-preview draft travels in a GET query string. URL-encoded, it can exceed Node's 16 KB `maxHeaderSize`, and Node then returns `431` before the hub's 400 check (Urdu notes grow about 6×) | **ruled (owner, 2026-11-11): (a)** hub `maxHeaderSize` 64 KB in `server.ts`, with a real-socket test (00 platform knob; integrator commit `b23e42f`) |
| AD-27 | 15, 19 | Lane 2B S-1: `SetLineWeight` on a return line (it copies `requires_weighing`) would give the return line money through the `LineWeightSet` fold | **ruled (owner, 2026-11-11): (a)** `409 LINE_NOT_WEIGHED { order_item_id }` (text bump §3.6) |
| AD-28 | 15, 16 | Lane 2B S-2: a command keyed only by line (`SetLineWeight`, `CompLine`) gets an unknown `order_item_id`. §9 lists `ORDER_NOT_FOUND` with `{ order_id }` | **ruled (owner, 2026-11-11): (a)** `ORDER_NOT_FOUND { order_item_id }` (text bump §9: `{ order_id } \| { order_item_id }`) |
| AD-29 | 17 | Lane 2C S-1: `MarkServed` on lines that are never in `EngineState`, where the fired check can't apply | **ruled (owner, 2026-11-11): H-b** a deal header → `400 VALIDATION_FAILED` (path `lines[i].order_item_ids[j]`); **N-a** a no-station line can be marked served, with no fired check (text bump §3.7) |
| AD-30 | 13 | Lane 2A `b67ede5` edited `server.ts` (outside its files). It duplicated fix I `b23e42f` at another spot, which would make a second `http` key | **ruled (owner, 2026-11-11): (a)** only `eta-preview-socket.int.test.ts` lands, as integrator commit `c2e40fc`; the `server.ts` hunk is dropped |
| AD-31 | 19 | Lane 2C S-2a: `ReturnToKitchen` to a paused station with no allowed alternate | **ruled (owner, 2026-11-11): (b)** `409 STATION_PAUSED` (text bump §6.7; 03b G0 question in `docs/OPEN-QUESTIONS.md` §5) |
| AD-32 | 19 | Lane 2C S-2b: `fix` when the item is no longer in config (`adjust_time_ms` needed) | **ruled (owner, 2026-11-11): accepted** `404 MENU_ITEM_NOT_FOUND { item_id }` (text bump §6.7) |
| AD-33 | 19 | Lane 2C S-2c: unknown `order_item_id` | **ruled (owner, 2026-11-11): accepted** `404 ORDER_NOT_FOUND { order_item_id }` (as AD-28) |
| AD-34 | 19 | Lane 2C S-2d: a zone-served line | **ruled (owner, 2026-11-11): accepted** `ITEM_WRONG_STAGE { stage: 'zone_served' }` (text bump) |
| AD-35 | 19 | Lane 2C S-2e: a deal header, or a line the engine doesn't hold, on an order still in the engine | **ruled (owner, 2026-11-11):** a distinct stage word `'not_engine_line'` (not `'out_of_engine'`), with a test (text bump) |
| AD-36 | 11–19 | **Wave 2 lane readings (bundle, built as read; reviewed by opus in the lanes).**
- 11: phone separators are stripped, then 10–13 digits; an empty-string name or phone → 400; `follow_up` has no live filter; scope `my_floors` on a named table (02a `OpenTable` Q1 differs: owner note); SubmitOrder statements are dine-in 5, takeaway 3, parking 2.
- 12: the zone statement count of 7 includes 01d's `listOpen`, which is stricter than "exclude 01d bounds".
- 14: an expired zone undo → `ITEM_WRONG_STAGE { stage: 'served' }`; a foreign line → 400 `lines.N.order_item_id`; a no-engine line in an engine order can be removed while unserved; cascaded option children must be at stage 1.
- 18: statements 1–2 (spec says 2–3: text bump); unknown released / expedite ids are dropped (`planRelease`); no `order_ids` cap.
- 19: a remake that is still open → `returned`; `stock_draws []`; `kitchen_note` is copied.

Duplication carried for the integrator:
- `remove-items.ts` copies the `exports.ts` row → `LineView` / `billed` rule;
- `requireFloorScope` repeats 02a `tables/lock.ts` `coversFloor`;
- the takeaway / parking scope helper is built in both 2B and 2C.

Options: (a) accept all as read (text bump for 12, 18), and dedupe in wave 4 or a later clean-up; (b) rule item by item. | **ruled (owner, 2026-11-11): (a) accepted as read**; text bump for 12, 18 and the scope note; dedupe carried |
| AD-37 | 21 | Lane 3A S-1: §6.15 `seating-orders` `groups: [{ promise_ms }]` has no source in `EngineState` (only `EngineOrder.promise_ms`; per-group promises are only in `OrderPlaced`) | **ruled (owner, 2026-11-11): (d)** returns the order-level `promise_ms` (`EngineOrder.promise_ms`), no per-group list (text bump §6.15) |
| AD-38 | 21 | Lane 3A S-2: §6.18 `order-contact` says "Statements: 1", but the shared MarkServed scope check reads `currentTableOf` under `my_floors` dine-in | **ruled (owner, 2026-11-11): (a)** 2 statements for `my_floors` + dine-in, 1 otherwise (text bump §6.18) |
| AD-39 | 21 | Lane 3A readings R1–R12 (opus-reviewed) | **ruled (owner, 2026-11-11):** R1 (`abandoned=true` is managers only) accepted. **R2 changed:** an order with no engine lines (only no-station / ready / zone-served lines) is **never** in the abandoned list, since it isn't waiting on the kitchen; with a test. R12 (`abandoned` + `order_type` = any type) accepted. **R8 changed:** `seating-orders` adds `fired: boolean` per line from the engine state (0 statements), so the client can enable Mark served; with a test. R3–R7, R9–R11 accepted as read. (Text bump §6.15, §6.16, §12.2 row 16) |
| AD-40 | 24 | #34 perf file readings: (1) "12 lines" = 12 `ItemAdded` (11 cart lines + 1 linked option child), dine-in on a held seating, no deal, no stock draws (the sim day counts no stock); (2) "peak engine" = the AD-27 normal peak day of seed 7, its state with the most lines (the 03a snapshot row's fixture), swapped in before each submit sample; the hub config routes the cart to the day's slot stations under the same ids; (3) one sample = one Fastify `inject` round trip; (4) §7's third row (`seating-orders` < 30 ms) is timed too, as a p99, on a table with 4 rounds of the cart; (5) 3 untimed warm-ups, 31 samples, as `fires-tick.perf.test.ts` | **ruled (owner, 2026-11-11): yes**, with a deal and a from-stock line added (`7125c76`; written, not run) |
| AD-41 | review G-1 | open-orders `from_date` with no open day: the code gave null between a close and the next open; v1.0.4 §6.16 says every order has a date | **ruled (owner, 2026-11-11): fix the code** (§6.16 stands); `3926e68` |
| AD-42 | review G-4 | §10 #29 had no test for `follow_up` / `seating-orders` after a merge | **ruled (owner, 2026-11-11): add it**, not waived; `e588fbf` |
| AD-43 | review G-3 / AD-36 | `SubmitOrder` checked `take-order` `my_floors` on every submit, blocking a `take-order-anywhere` holder that 02a let in | **ruled (owner, 2026-11-11): 02a's rule** (holder, or `take-order-anywhere` within its scope, through `requireLock`); spec **v1.0.5 APPROVED** `677c324`; code `e4b363a` (SubmitOrder; RemoveItems too, through §3.14's "as SubmitOrder on the current table") |
| AD-44 | review G-5 | 00: a missed-pong terminate pausing the idle clock had no test | **ruled (owner, 2026-11-11): add it** (test-only); `7bef4c0` |
| AD-45 | 25 | Q-1 (G2b-9): one `QueueStore` / `DraftStore` interface (no Capacitor import) + IndexedDB implementation now for every hub-served client; SQLite in 01d 9b T1; size L, two reviewers — spec v1.0.11 §3.12 | **accepted (owner 2026-11-12)** |
| AD-46 | 25 | Q-2 (G2b-8): `session_token` memory-only (00 §8.1 unchanged); after reload / restart every entry → queue log "Send again as {current person}" (same `command_id`); pending logout dropped after restart — spec v1.0.11 §3.12, §8 | **accepted (owner 2026-11-12)** |
| AD-47 | plan | Q-3 (G2b-13): shell task first; takeaway / parking / lists / queue lanes start at once; the dine-in lane waits for 02a's table view; 02b's queue implements 02a's `enqueue()`, the order screen mounts `useTableLock` + `LockBanner` (02a AD-27) | **accepted (owner 2026-11-12)** |
| AD-48 | hub gap batch + 27a | Q-6 (G2b-2): `ItemStarted`, `ItemDone`, `ItemDoneUndone`, `FireDispatched` → staff sockets + kiosks; debounced refetch of open views; no Refresh line — spec v1.0.11 §6.19, §8, test 41 | **accepted (owner 2026-11-12)** |
| AD-49 | hub gap batch + 27a | Q-7 (G2b-1): `LineView.options`, `SeatingOrder.order_note`; plain options under the line; "Send it as a new item" preselects by name; `option_id` (0017) deferred — spec v1.0.11 §4.2, §6.15, §8, test 42 | **accepted (owner 2026-11-12)** |
| AD-50 | hub gap batch + 27a | Q-8 (G2b-3): new query `order-view?order_id=` (one `SeatingOrder`, 2 + 1 statements); Served / Not served fallback until it lands; dine-in scope open (§12.3 Q6) — spec v1.0.11 §6.18a, test 43 | **accepted (owner 2026-11-12)** |
| AD-51 | hub gap batch + 27b | Q-9 (G2b-4): open-orders rows carry `placed_by { staff_id, name }`, dine-in `table_id`; ≤ 3 statements — spec v1.0.11 §6.16, test 44 | **accepted (owner 2026-11-12)** |
| AD-52 | hub gap batch + 27a | Q-10 (G2b-5): `SlipWarned` → staff sockets + kiosks; catch-up `open_slips`; interim each card answered alone — spec v1.0.11 §6.18 catch-up, §6.19, §8, test 45 | **accepted (owner 2026-11-12)** |
| AD-53 | hub gap batch + 27a | Q-11 (G2b-6): pending comp result `value_minor`; `pending_comp` per line in `seating-orders` (3 statements) — spec v1.0.11 §3.9, §6.8, §6.15, test 46 | **accepted (owner 2026-11-12)** |
| AD-54 | 27a + cloud | Q-19 (G2b-7): config chips sent as `reason_code` = label; fixed Other chip sends `'other'` + note; cloud default drops "Other" (new migration or default code; 0009 untouched) — spec v1.0.11 §3.9, §8; 01a v2.4.4 | **accepted (owner 2026-11-12)** |
| AD-55 | 26 | Q-20 (G2b-11): "Start day" opens `/admin/stock/` for `manage-stock` at `branch`; others "Ask the manager" — spec v1.0.11 §8 | **accepted (owner 2026-11-12)** |
| AD-56 | 25 | Q-21 (G2b-10): device idle lock by wall clock since last tap, checked on resume and before every tap; `idle_ttl_ms ≤ 0` = lock at once — spec v1.0.11 §8 | **accepted (owner 2026-11-12)** |
| AD-57 | 26 | Q-22 (G2b-12): stock mirror from catch-up + `Stock*` frames folded with `@pos/engine`; the order-screen task's first test proves it; if it fails, staff stock read and STOP — spec v1.0.11 §8 | **accepted (owner 2026-11-12)** |
| AD-58 | cloud | Q-23 (G2b-15): Cashier default gains `mark-served` (not `boost-order`); `default-roles.ts`, re-seed (R29) — 01b v1.8.1, spec v1.0.11 §3.14 | **accepted (owner 2026-11-12)** |
| AD-59 | 27a | Q-24 (G2b-16): "Void…" shown disabled, "Comes with module 04" — spec v1.0.11 §3.5, §8 | **accepted (owner 2026-11-12)** |

## Owner rulings (this sprint)

| Date | Ruling | Where |
|---|---|---|
| 2026-11-10 | G-1 (a), G-2 (a), G-3 (a), G-7 re-cut from `main` | plan "Gaps — ruled" |
| 2026-11-10 | AD-7 tighten `OrderPlaced` `token` / `car_type` schemas; AD-8, AD-9, AD-10 accepted (one contracts commit); AD-11 spec change → 02b v1.0.3 APPROVED; the plan's migration-list path (`test/alerts/` → really `test/db/`) noted here, no plan edit | AD rows, "Next 02b text bump", Wave 0 entry |
| 2026-11-10 | AD-12 (a) `utc_offset_ms` in `BuildSubmitCtx`; AD-13 (a) `after: { kind: 'served'; order_item_ids } \| 'change' \| 'return'` | AD rows, "Next 02b text bump" |
| 2026-11-11 | AD-14 keep as built; AD-15 (A) `ItemAdded.return_of`; AD-16 (a) draws resolver; AD-17 keep 400; AD-18 ignore `variant_id`; AD-19 `{ deal_id, opens_at_ms }`; AD-20 (b) note to every engine part; AD-21 lane 1C readings accepted, plus a plan patch for task 11; AD-22 `isEngineLine` re-export. Test-only: the ledger comp-then-weight test starts from a weighed line; the property test never comps a weight-pending g line; in the fixtures, a g/ml deal part's quantity = part quantity × deal count (01c §3.4.2) | AD-14–AD-22, "Next 02b text bump", plan task 11 |
| 2026-11-11 | AD-1–AD-6 accepted as read; AD-23 (a) fixture deal weights by the 01c V11 c / M9 reference choice (test-only) | AD rows |
| 2026-11-11 | AD-24 (a) zone-audience clause → task 21, task 20 asserts 403; AD-25 §6.9 branch stock read = in memory, 0 SQL | AD rows, plan tasks 20 / 21 |
| 2026-11-11 | AD-26 hub `maxHeaderSize` 64 KB; AD-27 return line weight → 409 `LINE_NOT_WEIGHED`; AD-28 `ORDER_NOT_FOUND { order_item_id }`; AD-29 H-b header → 400, N-a no-station line can be served | AD rows, "Next 02b text bump", `docs/OPEN-QUESTIONS.md` §6 |
| 2026-11-11 | AD-30 land only lane 2A's socket test; AD-31 return to a paused station → 409 `STATION_PAUSED`; AD-32–AD-34 accepted; AD-35 stage `'not_engine_line'` | AD rows, "Next 02b text bump", `docs/OPEN-QUESTIONS.md` §5 |
| 2026-11-11 | AD-36 (a) wave 2 lane readings accepted as read; the SubmitOrder / OpenTable scope note goes in the text bump; the three duplicates are carried | AD-36, "Next 02b text bump", Wave 2 entry |
| 2026-11-11 | AD-37 (d) order-level promise; AD-38 (a) order-contact 1 / 2 statements; AD-39 lane 3A readings, R2 and R8 changed. **"Next 02b text bump" becomes spec v1.0.4, written in wave 4, APPROVED now** | AD-37–AD-39, "Next 02b text bump" |
| 2026-11-11 | After the build review: G-1 fix the code (AD-41); AD-40 yes; G-4 add the #29 test (AD-42); AD-36 / G-3 02a's rule, spec v1.0.5 APPROVED (AD-43); G-5 add the 00 test (AD-44) | AD-40–AD-44, build review |

## Next 02b text bump

**Applied in v1.0.4 (`2589c78`, `7e711f5`)**, except AD-36's single 02a / 02b `my_floors` rule (needs an owner decision; see the build review). Parts for other modules' next bumps: 03a §4.2 `ItemAdded.return_of?` (AD-15), 00 `maxHeaderSize` 64 KB (AD-26), 02a §3.2 scope rule (AD-36), 01c §4.3 deal `kitchen_note` to engine parts (AD-20).

**Owner, 2026-11-11: wave 4 writes this list as `02b_Ordering_Spec_v1.0.4.md` (APPROVED now), with "⚠️ Changed by v1.0.4" markers and the README row.**

Readings already accepted in code that the next 02b text patch writes into the spec (owner, 2026-11-10):

- **AD-8:** §4.2 / §3.2 — `buildSubmit(config, input, ctx)` with `ctx: { now, isAvailable, primary_table_id | null, follow_up }` (+ AD-12 if ruled). Zone candidates are built as kitchen lines, and `SubmitOrder` removes the zone-served ones after the count check and sets `served_from_zone_id`.
- **AD-9:** §4.2 / §3.5 — `lineChangeDrafts(ctx: CommandCtx, order_id, changes)`; read the spec's `tx` as `ctx.tx`. The closes carry the caller's actor and device (02a `requireLock` precedent).
- **AD-10:** §4.2 / §3.3 — `foodDrafts` returns drafts without time / actor / device (`{ stream_type, stream_id, event_type, schema_version, payload }`), and the caller adds the envelope. `lines` = the order's lines after the change. AD-13: `after` = `{ kind: 'served'; order_item_ids } | 'change' | 'return'`; `OrderFoodServed` only when the served ids include a food line (§3.3).
- (AD-1 from the plan: cite 02a v1.1.3 in the header and §3.2 step 2.)
- **AD-14:** §3.3 / §3.5: `food_served` counts served food lines, including one voided after it was served.
- **AD-15:** 03a §4.2 (ItemAdded fields) and 02b §6.19 / §3.8: `ItemAdded.return_of?` is set on a return line's `ItemAdded` (fix and remake). 02b §5 folds it into `order_lines.return_of`.
- **AD-16:** §3.2 / §4.2: `BuildSubmitCtx.draws` takes the day-frozen draws from `dayDraws` (01c V20).
- **AD-17:** every mention of "422 `VALIDATION_FAILED`" becomes **400** (§4.4, §10 #1, §3.4 `gml_deal_part_partial`, §3.5 `units > live_units`).
- **AD-18:** §6.1: drop `variant_id` from the payload, or mark it "accepted and ignored".
- **AD-19:** §9: `ITEM_OUT_OF_HOURS { item_id | deal_id, opens_at_ms | null }`.
- **AD-20:** §3.2 / 01c §4.3 row: a deal's `kitchen_note` is copied to every engine part.
- **AD-25:** §6.9 statements: "1 branch stock read" → "branch stock read from the engine state in memory (0 SQL)".
- **AD-26:** §6.14 notes that the hub's `maxHeaderSize` is 64 KB (a 00 platform knob, also in the next platform batch, `docs/OPEN-QUESTIONS.md` §6).
- **AD-27:** §3.6 says `SetLineWeight` on a return line → `409 LINE_NOT_WEIGHED`.
- **AD-28:** §9 `ORDER_NOT_FOUND` details become `{ order_id } | { order_item_id }`.
- **AD-29:** §3.7 / §3.4 say `MarkServed` naming a deal header → `400 VALIDATION_FAILED`, and a no-station line is served with no fired check.
- **AD-36:**
  - §3.14 / §6.1: write down how `SubmitOrder`'s scope `my_floors` applies to a named table, and align the text with 02a `OpenTable` (02a v1.1.4 §3.2: `take-order` `my_floors` "with the floor"; owner note Q1). 02a and 02b must say the same thing. If they differ, the next text bump of each (02a and 02b) states one rule.
  - §3.10 / §6.1: the zone statement count includes 01d's `listOpen`.
  - §6.5: `ReleaseItems` / `BoostOrder` statements are 1–2.
- **AD-37:** §6.15 `seating-orders` gives `promise_ms` per order (order level), not `groups: [{ promise_ms }]`.
- **AD-38:** §6.18 `order-contact` statements: 1, or 2 with `my_floors` on a dine-in order.
- **AD-39:**
  - §6.16: `abandoned=true` is managers only (§12.2 row 16 says staff: fix it), and an order with no engine lines is never abandoned.
  - §6.15: lines carry `fired: boolean`.
  - R3–R7 and R9–R11 are written down as read.
    - R3: in ready n / m, deal headers are left out and return lines count in m; a line is ready when served or at engine stage done / served (§6.16).
    - R4: the open-orders promise = `EngineOrder.promise_ms` while in the engine, else null; null sorts last (§6.16).
    - R5: `from_date` is set when `business_date` ≠ the open day's date; with no open day, every order (§6.16).
    - R6: the `OrderContactSet` placer = the envelope `actor_id` (§6.19 audiences).
    - R7: "holds `apply-comp`" includes a `requires_approval` grant (§6.19 audiences).
    - R9: order-contact checks permission → order → scope (§6.18).
    - R10: the catch-up part goes to every staff socket and kiosk, every order type, no `stage` (catch-up part `orders`).
    - R11: `zone-stock` with an unknown or archived `zone_id` → `404 ZONE_NOT_FOUND`; rows whose item left the config are hidden (§6.17).
- **AD-31–AD-35:** the §6.7 `ReturnToKitchen` error list gains:
  - `409 STATION_PAUSED` (paused station, no alternate);
  - `404 MENU_ITEM_NOT_FOUND` (`fix` with the item gone);
  - `404 ORDER_NOT_FOUND { order_item_id }`;
  - `ITEM_WRONG_STAGE` stages `'zone_served'` and `'not_engine_line'`.

## Wave entries

*(one per checkpoint, newest last; same shape as 02a's)*

## Wave 0 — codes, events, migration, contracts, zone kinds (2026-11-10)

- **Tasks:** 1, 2, 3, 4, 5 (integrator, sequential).
- **Commits:** `f024331` (1), `ed359f3` (2), `8ec74c0` (3), `c2a05b1` (4), `81b365a` (5). No fix commits.
- **Reviews:** a fresh implementer and a fresh opus reviewer for each task. 1, 2, 3 and 5 were approved first pass. **4: "Needs fixes", with 3 Important findings, all plan-mandated contract signatures (AD-8, AD-9, AD-10).** These are not fixed here ("never accept your own reading"). The contract fix is one integrator commit **before wave 1**, once you rule. Task 2: there is one plan-mandated Important finding. Its stream asserts build an envelope and check it, and prove nothing (the registry has no stream, same as 02a). Ruling: no fix in 2. Task 20 asserts `stream_type 'table'` and `stream_id 'zone:'+zone_id` on the appended `ZoneStockAdded` / `ZoneStockSet`. `OrdersBilled` is written by 05 (AD-5).
- **Gate:** TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test". Result: 401 files (1 skipped), 3807 tests passed (1 skipped, 1 todo), 563 s wall. Green.
- **§12.2 rows ticked:** 12 (`zone_stock_low`), 13 (`zone_stock_out`), kinds only. Their #14 command clauses are in task 20.
- **Statement counts asserted:** `zoneAlertDrafts`: one `listOpen` per zone subject (task 5).
- **Tests closed:** `[02b #14 alerts]`, plus the `[02b §9]`, `[02b §6.19]`, `[02b §5]`, `[02b §4.2]` and `[02b fixtures]` support tests.
- **Also:** `apps/hub/test/db/alerts-migration.int.test.ts` adds `0013_orders.sql` to its pinned migration list. The plan's path `test/alerts/` was wrong, and the integrator corrected it. G-2 edits: none.
- **Fixtures (task 4):** `apps/hub/test/orders/fixtures.ts` provides `fixtureMenu()`, `openDay`, `openSeating`, `appendOrder` and `setZoneStock`. Each appends real events through the writer. `appendOrder` writes `token` as a string (AD-7).
- **AD rows (proposed):** AD-7 (token / car_type types), AD-8 (`BuildSubmit` context), AD-9 (`LineChangeDrafts` ctx), AD-10 (`FoodDrafts` draft shape), AD-11 (zone out-alert close).
- **Carried (minor, deferred):**
  - Task 2:
    - the five-schema test checks key sets only, not nullability;
    - `OrderContactSet` has no test for a missing `customer_name` or `order_id`.
  - Task 3: the migration test does not isolate CHECK `removed_units + voided_units <= units`.
  - Task 4:
    - add a doc line "readers convert 0/1 → boolean; never cast rows";
    - export `SubmitOption`;
    - the fixture deal header's `line_total_minor` ignores extras.
  - Task 5:
    - the label key is built from a string (add a drift test);
    - document "one direction per item per call";
    - §6.13 names `alert.zone_stock_out.lock` only implicitly;
    - no re-raise after a day-close expiry while the count is still low.

### Wave 0 — owner rulings applied (2026-11-10)

- **Commits:**
  - `631b336`: AD-7. `OrderPlaced.token` is an int ≥ 1 and `car_type` is an enum. The fixture writes an int token.
  - `b9b3167`: spec v1.0.3 (AD-11), its README row, and the plan's Spec line.
  - `f8b9e85`: AD-8–AD-10 contract signatures, plus the task-4 minors (doc line "readers convert SQLite 0/1 → boolean; never cast rows" and `SubmitOption` exported).
  - `602a7a4`: `zoneAlertDrafts` follows v1.0.3. Out closes above 0 and low closes above its threshold. New test `[02b #14 alerts] 0 → 1 closes out, low stays open while ≤ threshold`, plus the task-5 minors (label drift test, one-direction comment).
  - `7273015`: v1.0.3 §3.5. The zone-undo sentence now points to §3.10's rule. It still had the old wording; this is the same AD-11 ruling, and the fix C review found it.
- **Reviews:**
  - Fix A (AD-7): approved.
  - Fix C (AD-11): approved by opus. Minor: the "0 → 9 closes both" test relies on `listOpen` order.
  - Fix B (AD-8–10): opus "Needs fixes". It found two gaps in the ruled shapes, now **AD-12** (hub UTC offset for S47) and **AD-13** (which lines a serve served). These amend owner rulings, so they are proposed and not built. They block tasks 10 and 9. Fix B minors (deferred): `FoodDrafts` element type is broad; `zoneCandidates` has no `zone_id`; `SubmitInput` needs ids, so eta-preview has to mint them (a doc line for lane 2A).
- **AD-12, AD-13** (`876dfdc`): `BuildSubmitCtx.utc_offset_ms`; `FoodDrafts` `after` with served ids. Review approved (sonnet). Checks: `apps/hub/test/orders` 4 files and 19 tests passed; hub `typecheck` and `typecheck:tests` clean. There was no full gate; the wave 1 gate covers it (owner).
- **Plan path note:** the migration-list test is `apps/hub/test/db/alerts-migration.int.test.ts`. The plan says `test/alerts/`. Owner: noted here, no plan edit.
- **Gate:** TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test". Result: 401 files (1 skipped), 3812 tests passed (1 skipped, 1 todo), 544 s wall. Green.

## Wave 1 — projection, exports, ledger, food rules, buildSubmit (2026-11-10 → 2026-11-11)

- **Lanes:**
  - 1A: tasks 6, 7.
  - 1B: tasks 8, 9.
  - 1C: task 10.
  - All cut from `f9a5fa0`. The laptop slept overnight, so the wave ran across two days.
- **STOPs:**
  - 1A: `return_of` → AD-15 (A).
  - 1C: S-1–S-5 → AD-16–AD-20; its readings → AD-21.
  - Ruled by the owner 2026-11-11. The integrator commits the lanes cherry-picked: `a3399b2`, `5d2773e`.
- **Landed (cherry-picked in table order once each lane was done; lane copies of integrator commits skipped by content, 02a AD-21):**
  - 1B: `48905b8`, `7fe766f`.
  - 1A: `c1593fe`, `e44ee9d`, `a1933ef`, `80206ab` (copy `44b3d61` skipped).
  - 1C: `3109fe8`, `8b513ac`, `575af53` (copy `de73033` skipped).
  - No conflicts. The `index.ts` lines are additive under their markers.
- **Integrator commits this wave:**
  - `a3399b2` `ItemAdded.return_of` (+ types-only engine `Omit`).
  - `5d2773e` `BuildSubmitCtx.draws`.
  - `559cb2f` `isEngineLine` re-export, so `food.ts` imports it (AD-22).
  - `fd8433d` ledger tests start from reachable states.
  - `d4829b5` fixture g/ml deal part quantity (01c §3.4.2).
  - `ea60f49` board / plan patch.
  - Each passed review (opus, except `5d2773e`/`a3399b2`, which opus reviewed together).
- **Reviews in the lanes:** one fresh opus implementer and one fresh opus reviewer per task.
  - 8: approved first pass.
  - 9: approved; its Important finding was a reading, now AD-14.
  - 6: approved, plus the AD-15 follow-up, approved.
  - 7: one fix round (3 addressed).
  - 10: one fix round, then the rulings fix, approved.
- **Gate:** `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`. 406 files (1 skipped), 3909 tests passed (1 skipped, 1 todo), 579 s wall. Green.
- **Replay identity #28:** `[02b #28] live projection = replayed projection over a fixture day, orders registered before and after tables` (`projection.int.test.ts`). Green.
- **Statement counts asserted:** `seatingTotals`, `orderLines` and `ordersOf` are 1 statement each over 40 orders (`exports.int.test.ts`, `[02b §4.2] one statement each`).
- **§12.2 rows ticked:** none (no command yet).
- **Files outside `orders/`:**
  - G-3 lines in `lib/boot.ts` and `test/helpers/test-hub.ts` (lane 1A).
  - The integrator commits above in `packages/events`, `packages/engine`.
  - G-2 edits: none.
- **AD rows:**
  - AD-14–AD-22 ruled (owner 2026-11-11).
  - **AD-23 proposed** (fixture deal weights).
- **Carried (minor, deferred):**
  - 1A:
    - no `LineWeightSet` → `billed_minor` case in the exports tests;
    - a return line sits in its own order (comment);
    - the `returnLine` test helper spreads options / `stock_draws`;
    - `LineWeightSet` ignores `return_of`.
  - 1B: the ledger kinds coverage is recorded before the comp skip (`ledger.test.ts:488`). Deal-part ledger "units" ≠ `ItemAdded.quantity` by design (`menu-lines.voids.test.ts:225`); don't "fix" it.
  - 1C:
    - deal parts in snapshot order (AD-21);
    - `plan.ts:1054` comment could cite 03a §4.2.

## Wave 2 — commands (2026-11-11)

- **Lanes:** 2A (tasks 11–13), 2B (14–16), 2C (17–19), 2D (20), all cut from `0bfa729`.
- **STOPs:**
  - 2D → AD-24, AD-25.
  - 2A → AD-26 (`maxHeaderSize`).
  - 2B → AD-27, AD-28.
  - 2C → AD-29 (S-1) and AD-31–AD-35 (S-2).
  - All ruled by the owner, 2026-11-11.
- **Landed (cherry-picked):**
  - 2D: `f3d3ccd`.
  - 2A: `89ece74`, `2ee6b18`, `0cc7633`, `fd76194`, `5a39c29`. Its `b67ede5` was not landed (AD-30); its test is in as `c2e40fc`.
  - 2B: `240a163`, `46e9528`, `46156a2`, `7659232`, `2a7056d`, `8c65d16`.
  - 2C: `80c07b5`, `193fa17`, `9e5801c`, `420f3cd`, `f725fb3`, `9645f4f`, `23af410`, `7831279`.
- **Conflicts:** two in `orders/index.ts`, both additive import lines (2A's `registerSubmitOrder` and `registerEtaPreviewQuery` against 2D's `registerZoneStock`). Kept every line, in lane order A before D (02a standing rule). No other conflict.
- **Integrator commits:** `6e7bc46` (AD-23 fixture weights), `b23e42f` (AD-26 `maxHeaderSize`, opus review), `c2e40fc` (AD-30), plus the board / plan rulings.
- **Reviews:** a fresh implementer and an opus reviewer per task, in the lanes.
  - Fix rounds: 11 (minors), 13 (1 Important: false sold-out after a sold-out deal part), 14 (1 Important: duplicated ledger rule), 16, 17, 18, 19.
  - Every owner-ruling fix was re-reviewed.
- **Gate:** `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`. 418 files (1 skipped), 4106 tests passed (1 skipped, 1 todo), about 583 s wall. Green.
- **§12.2 rows ticked:** 1–10 (commands `submit-order` … `set-zone-stock`) and 11 (kind `comp`). Rows 12 and 13 were ticked at wave 0.
- **Statement counts asserted (`statementCounter`):** every command test file (`submit-order`, `submit-zone`, `eta-preview`, `remove-items`, `set-line-weight`, `comp`, `mark-served`, `release-boost`, `return-to-kitchen`, `zone-stock`), with the numbers as read in AD-36 and AD-25.
- **Files outside `orders/`:** `server.ts` (`b23e42f`, integrator). G-2 edits: none.
- **Carried (minor, deferred):**
  - Duplicate code (AD-36, owner 2026-11-11: carry, dedupe later):
    - `remove-items.ts` copies the `exports.ts` row → `LineView` / `billed` rule;
    - `requireFloorScope` repeats 02a `tables/lock.ts` `coversFloor`;
    - the takeaway / parking scope helper is built in both 2B (`remove-items.ts`) and 2C.
  - 2A:
    - empty-string name / phone (AD-36);
    - no merged-secondary-table preview test;
    - `rows.find` O(n²) in `zoneServe`;
    - `OrderContactSet` placement next to the zone `ItemServed`;
    - the 64 KB limit applies to all routes;
    - `afterEach` close guard and a duplicated `directory()` test helper.
  - 2B:
    - `remove-items.ts` message for 0 live units;
    - a `?? 0` fallback (spec default 300 000);
    - no test for a g/ml line without `requires_weighing` → `LINE_NOT_WEIGHED`;
    - no test for a deal_part / option_child target.
  - 2C: the O16 unfired-line branch can't be reached by real events (it's tested on the reachable side).
  - 2D (task 20 review):
    - the D32 count-retransmit test doesn't prove "no new event";
    - the `ZONE_NOT_FOUND` test doesn't assert that nothing was appended;
    - the 403 test is tagged `#33` (retag `§3.14`);
    - archived zone → 404 is untested;
    - the lead's zone (B-3) is untested;
    - the frame wait loop could use a `until*` helper.
  - Fix I: assert the exact 401, not "not 431"; possible ECONNRESET on the 70 KB case.

## Wave 3 — queries, catch-up, audiences, queued replays, handover amount (2026-11-11)

- **Lanes:** 3A (task 21), 3B (22), 3C (23), all cut from `32d0d03`.
- **STOPs:** 3A only, S-1 and S-2 plus readings R1–R12, ruled as AD-37–AD-39 (owner, 2026-11-11). 3B and 3C finished with no STOP.
- **Landed (cherry-picked, no conflicts):**
  - 3C: `b3e984f`.
  - 3B: `39452dc`, `84859dc`.
  - 3A: `ffdc43f`, `ce0410f`, `9e5d7ae`.
- **Files outside `orders/`:**
  - 3C (G-1 (a)): `tables/handover.ts` (the `registerSeatingTotals` hook) and `tables/commands/request-table-handover.ts`, where the card is built and the plan's "1 statement more on the handover path" lives. That is within the G-1 ruling.
  - 3A (G-2 (a), test-only): `test/engine/stations-live.int.test.ts`. Staff sockets now get the 02b order-stream events (02b §6.19). The KDS assertion stays exact ("no order event"), so nothing is weakened.
- **Reviews:** one fresh implementer and an opus reviewer per task.
  - 21: approved (5 minors), then the owner-ruling fix and the R2 fix, both reviewed.
  - 22: approved (1 minor fixed, 3 parked with no change).
  - 23: approved (3 minors carried).
- **Gate:** `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`. 420 files (1 skipped), 4135 tests passed (1 skipped, 1 todo), 577 s wall. Green.
- **§12.2 rows ticked:** 14 (`eta-preview`, built in wave 2 and its row closed here with the queries), 15 `seating-orders`, 16 `open-orders`, 17 `zone-stock`, 18 `order-contact`, 19 catch-up `orders`. All 19 rows are now ticked.
- **Statement counts asserted:**
  - `[02b #33 queries]`: seating-orders 2, open-orders 2, zone-stock 1, order-contact 1 (2 under `my_floors` dine-in, AD-38), catch-up part `orders` 3.
  - Handover: +1 (`seatingTotals`, 02a #12 amount).
- **Also closed:**
  - `[02b #33 zone audience]` (moved here by AD-24);
  - `[02b AD-6]` zone events reach no 02a reader;
  - `[02b #31 02b]`, `[02b #13 queued]`, `[02b #22 queued]` (task 22);
  - `[02a #12 amount]` (task 23).
- **Carried (minor, deferred):**
  - 3B, parked with no change:
    - the hard-coded 10-path registry list in `queued.int.test.ts`;
    - a misplaced comment;
    - the clamp may put `served_at` before `placed_at` (the spec allows it).
  - 3A: 3 minors (lane notes).
  - 3C: 3 minors (lane notes). Its reading: `seatingTotals` is called whenever the hook is registered, and `amount` appears only when `live_orders > 0`.

## Acceptance map (task 24, 2026-11-11)

Spec 02b v1.0.3 §1.1, §10 and the §10 "Acceptance" table. Every name below is a real `it(...)` title, quoted from its start (grep the quoted text). Paths are under `apps/hub/test/` unless they start with `packages/`. Short file names: `submit` = `orders/submit-order.int.test.ts`, `zone` = `orders/submit-zone.int.test.ts`, `build` = `orders/build-submit.test.ts`, `remove` = `orders/remove-items.int.test.ts`, `served` = `orders/mark-served.int.test.ts`, `rb` = `orders/release-boost.int.test.ts`, `return` = `orders/return-to-kitchen.int.test.ts`, `comp` = `orders/comp.int.test.ts`, `weight` = `orders/set-line-weight.int.test.ts`, `zstock` = `orders/zone-stock.int.test.ts`, `zalerts` = `orders/zone-alerts.int.test.ts`, `ledger` = `orders/ledger.test.ts`, `food` = `orders/food.test.ts`, `proj` = `orders/projection.int.test.ts`, `exports` = `orders/exports.int.test.ts`, `queries` = `orders/queries.int.test.ts`, `queued` = `orders/queued.int.test.ts`, `preview` = `orders/eta-preview.int.test.ts`, `perf` = `orders/submit.perf.test.ts`.

Status words: **green** = hub tests exist and passed in the wave 3 gate (4135 tests). **pending run** = the #34 perf file, written and typechecked, never run by an agent (AD-4); the owner runs `pnpm test:perf`. **GAP** = no test. Client tests (§10 #35, #36, `apps/client`) do not exist: wave 5 is blocked on the design handoff, so every client half is a GAP until tasks 25–27 land.

### 1. Story ACs (§1.1) → tests

| Story AC | §10 # | Tests (real names) | Status |
|---|---|---|---|
| E2-TBL AC9 dine-in, takeaway, parking (delivery, web deferred) | 1, 16 | submit `[02b #1] dine-in happy path`, `[02b #1] parking: table_key from car_number_norm`, `[02b #1] delivery → 400 VALIDATION_FAILED`; `[02b #16] token 1, 2, 3 per business date`; build `[02b §3.1] takeaway: table_key takeaway:<order_id>` | green |
| E2-ADD AC1 each addition a new order, earlier timing unchanged | 10 | submit `[02b #10] round 2 is a new order` | green |
| E2-ADD AC2 live ETA preview, locked at submit | 33, 36 | preview `[02b #33 preview] appends nothing`, `[02b #33 preview] follow_up: round 2 preview = round 2 submit` | hub green; screen half **GAP** (#36) |
| E2-ADD AC3 fires to the kitchen on submit | 1 | submit `[02b #1] dine-in happy path` (batch: `OrderPlaced` → `ItemAdded` into the engine) | green |
| E2-ADD AC4 rounds grouped on the table view by time | 36 | queries `[02b §6.15] the seating's orders by placed_at` | hub green; table view **GAP** (#36) |
| E2-ETA AC1 ≤ 1 s per item added | 34, 36 | perf `[02b #34 submit]`, `[02b #34 preview]` | **pending run** (AD-4); screen half **GAP** (#36) |
| E2-ETA AC2 per-item ETA, sorted earliest first | 1, 33, 36 | preview `[02b #33 preview] appends nothing` (lines `eta_ms`, groups `promise_ms`) | hub green; sort on screen **GAP** (#36) |
| E2-ETA AC3 stock time if stock > 0, else full cook | 7, 33 | submit `[02b #7] cook_fresh short of stock → full cook time`; preview `[02b #33 preview] uses from_stock` | green |
| E2-ETA AC4 queue wait (cooking, ahead, capacity) | 1 | submit `[02b #1] dine-in happy path` (`planOrder` groups; the math is 03a's own tests) | green |
| E2-ETA AC5 preview reserves nothing | 33 | preview `[02b #33 preview] appends nothing`, `[02b #33 preview] uses from_stock` ("nothing claimed") | green |
| E2-ETA AC6 promise locked, shown on the table view | 1, 36 | submit `[02b #1] dine-in happy path` (`promise_ms only`); queries `[02b §6.15] the seating's orders by placed_at` (order-level `promise_ms`, AD-37) | hub green; display **GAP** (#36) |
| E2-SOLD AC1 sold out greyed, cannot be added | 6, 7, 36 | build `[02b #6] manual Off → ITEM_UNAVAILABLE`; submit `[02b #7] sold out is never ITEM_UNAVAILABLE`, `[02b #7] sold_out with 0 < available < needed` | hub refusal green; label **GAP** (#36) |
| E2-SOLD AC2 slow item clock icon | 36 | — (client only; `slow_item_threshold_ms` is config) | **GAP** (#36) |
| E2-SOLD AC3 real time < 5 s | 33, 36 | zstock `[02b #33 refill tile] a refill sends the StockTransferredOut stock frame`; queries `[02b #33 zone audience]` | hub push green (no timing assert, AD-32); tile **GAP** (#36) |
| E0-ORD AC1 Hold (device only; manager view §12.4) | 35 | — (device-local drafts) | **GAP** (#35) |
| E0-ORD AC2 order and item notes | 2 | submit `[02b #2 order_note] order_note on OrderPlaced`; build `[02b §3.2] S-5: a deal kitchen_note is on the header and every engine part` (printing: 03b) | green |
| E0 comps AC3 comp, reason, logged | 26, 27 | comp `[02b #26] allowed → LineComped with the next free shares`, `[02b #26] approve → LineComped { alert_id, approver_staff_id, requester_staff_id }`, `[02b #27] reason_code 'other' without a note → 400`, `[02b #27] an approved 'other' comp keeps its note` (bill label: 05) | green |
| E0 comps AC4 cancellation at stage 1 | 18, 37 | remove `[02b #18] remove every line → OrderCancelled in the batch`, `[02b #18] deal remove with one part cooking → refused`, `[02b #37 remove] remove 1 of 2 deals at stage 1` | green |
| E0 comps AC5 permission + immutable log | 26, 38 | comp `[02b §3.14] a caller without apply-comp → 403 PERMISSION_DENIED`, `[02b #38 comp] remake a karahi → still billed` | green |
| E5-DEV AC1 device queues while the hub is away | 35 | — | **GAP** (#35) |
| E5-DEV AC2 replay in timestamp order | 31, 35 | hub accepts the replay: queued `[02b #31 02b sent_after_reconnect]`; order on the device: — | hub green; device **GAP** (#35) |
| E5-DEV AC3 no order lost in a restart within the window | 31 | `auth/idle-pause.int.test.ts` `[00 #154] hub down 60 s across the TTL`; queued `[02b #31 02b sent_after_reconnect]` | green |
| E5-DEV AC4 "Reconnecting…", no "sent" before 2xx | 35 | — | **GAP** (#35) |
| E5 edge: order in progress preserved | 35 | — (drafts survive reload) | **GAP** (#35) |
| Z3 zone routing | 11 | build `[02b #11] the route of the primary table zone wins`, `[02b #11] takeaway and parking ignore zone routes` | green |
| Z4 zone stock served at the table | 12, 13, 15 | zone `[02b #12] zone-only raita round`, `[02b #13] two raita lines of 4 with 6 left`; remove `[02b #15] undo a zone line within zone_undo_ms` | green |
| Z5 refill recorded | 14 | zstock `[02b #14 commands] a refill drafts one StockTransferredOut per day draw` | green |
| Z7 threshold notifies | 14 | zalerts `[02b #14 alerts] a count from above threshold to <= it raises zone_stock_low`, `[02b #14 alerts] 0 → 1 closes out` | green |
| C2 comp at order time (approval) | 26, 27 | comp `[02b #26] approval: requires_approval passes the registry`, `[02b #27] pending comp on 2 of 3, then remove 2` | green |
| C3 comp on the bill, same command | 26 | comp `[02b #26] allowed → LineComped with the next free shares` (the bill effect is 05's) | green |
| G0-6 Served by tap | 22, 23 | served `[02b #22] lines of 2 orders: one ItemServed per order`, `[02b #23 serve] default waiter (mark-served branch, AD-32)` | green (estimated Served: O14, registered with 03b's Handover, not a 02b test) |
| Owner Q4 token | 16 | submit `[02b #16] token 1, 2, 3 per business date` | green |
| Owner Q5 food on table only for food lines | 12 | zone `[02b #12] owner Q5: water + raita only → ORDERED, never green` | green |
| Owner Q6 comp by permission | 26 | comp `[02b #26] approval: requires_approval passes the registry` | green |
| Owner Q7 order taker taps Served | 22, 23 | served `[02b #22] lines of 2 orders`, `[02b #23 serve] takeaway / parking: own_tables and my_floors` | green |
| Owner Q8 queued auto-send | 31 | queued `[02b #31 02b sent_after_reconnect]`; idle-pause `[00 #152]` | green |
| 02b Q1 refill is a transfer | 14 | zstock `[02b #14 commands] a refill drafts one StockTransferredOut per day draw`, `[02b #14 commands] a count writes ZoneStockSet` | green |
| 02b Q2 partial comp | 26 | comp `[02b #26] allowed → LineComped with the next free shares (3 333, then 3 333 + 3 335)` | green |
| 02b Q3 partial remove | 17 | remove `[02b #17] 1 of 4 from-stock karahi` | green |
| 02b Q4 no day, no order | 4 | submit `[02b #4] no open business day` | green |
| 02b Q5 zone routing | 11 | build `[02b #11] the route of the primary table zone wins` | green |
| 02b Q6 non-table orders belong to the placer | 23 | served `[02b #23 serve] takeaway / parking`; remove `[02b #23 remove] takeaway removed by its placer`; rb `[02b #23 boost] takeaway boosted by its placer` | green |

### 2. §10 tests 1–40 → files and names

| # | File | Names (start of the title) | Status |
|---|---|---|---|
| 1 | submit, build | `[02b #1] dine-in happy path`, `[02b #1] delivery → 400`, `[02b #1] parking: table_key`, `[02b #1] TABLE_SEATING_CHANGED (stale or unknown seating) and TABLE_NEEDS_CLEANING` | green |
| 2 | build, submit | `[02b #2] family deal: allocation 229 315 / 12 508 / 78 177`, `[02b #2] a choice with an extra`, `[02b #2] a batch route copies the program cook times`, `[02b #2] a weighed line without a weight`, `[02b #2 order_note]` | green |
| 3 | preview, build | `[02b #3] config applied between preview and submit`, `[02b #3 pure] the lines use the config it is given` | green |
| 4 | submit | `[02b #4] no open business day` | green |
| 5 | submit | `[02b #5] an id repeated in the payload`, `[02b #5] an id already in orders / order_lines` | green |
| 6 | build | `[02b #6] unknown item`, `[02b #6] manual Off`, `[02b #6] out of hours on hub time`, `[02b #6] outside the category's window`, `[02b #6] S-4: a deal outside its windows`, `[02b #6] a required group that cannot be satisfied`, `[02b #6] a linked option whose item is Off` | green |
| 7 | submit | `[02b #7] sold_out with 0 < available < needed`, `[02b #7] sold out is never ITEM_UNAVAILABLE`, `[02b #7] cook_fresh short of stock` | green |
| 8 | submit | `[02b #8] paused station` | green |
| 9 | submit | `[02b #9] two submits on the last Paye` | green |
| 10 | submit | `[02b #10] round 2 is a new order` | green |
| 11 | build | `[02b #11] the route of the primary table zone wins`, `[02b #11] takeaway and parking ignore zone routes` | green |
| 12 | zone, food | zone: 13 `[02b #12]` tests (from `zone-only raita round` to `replay of orders and tables registered in either order`); food: 15 `[02b #12 pure]` tests | green |
| 13 | zone, queued | `[02b #13] two raita lines of 4 with 6 left`, `[02b #13] two submits on the last raita`, `[02b #13] a queued replay with the zone emptied`, `[02b #13 queued] the tablet drops past its idle TTL` | green |
| 14 | zstock, zalerts | 4 `[02b #14 commands]`, 12 `[02b #14 alerts]` (incl. `0 → 1 closes out, low stays open while ≤ threshold`, v1.0.3) | green |
| 15 | remove | `[02b #15] undo a zone line within zone_undo_ms`, `[02b #15] the fold adds back regardless`, `[02b #15] undo on a zone-only round works`, `[02b #15] an undo lifting the count above the threshold`; `ReturnToKitchen` on a zone line: return `[02b #25] stage errors` | green |
| 16 | submit, proj, queries | `[02b #16] token 1, 2, 3 per business date`; m-3 and the carried token's date: proj `[02b #30 fold] day close sets day_closed_at only on cancelled, billed or finished orders`, queries `[02b #30 open-orders] a carried takeaway shows under the next day with its date` | green |
| 17 | remove | `[02b #17] 1 of 4 from-stock karahi` | green |
| 18 | remove | 9 `[02b #18]` tests (`remove every line → OrderCancelled` … `lock held by another → TABLE_ALREADY_LOCKED`) | green |
| 19 | ledger, remove, weight | 5 `[02b #19 pure]`, 4 `[02b #19 command]`, `[02b #19 weight] weigh, comp, then a correction → 409 LINE_ALREADY_SETTLED` | green |
| 20 | ledger | `[02b #20] a deal's money equals 01c #119's reference model`, `[02b #20] 1 000 random comp / remove / void / remake / weight sequences` | green |
| 21 | weight | 5 `[02b #21]` tests | green |
| 22 | served, queued | 4 `[02b #22]` tests (incl. `abandoned order (out of the engine, O16`), 3 `[02b #22 queued]` | green |
| 23 | served, remove, rb, submit | `[02b #23 serve]` ×2, `[02b #23 remove]`, `[02b #23 boost]` ×3, `[02b #23 submit]` | green |
| 24 | rb | `[02b #24] the alert_id from planRelease is closed done via one closeMany`, `[02b #24] merged party with two original seatings both late`, `[02b #24] no extra read` ("no 03a code touched": no 03a file in the 02b diff) | green |
| 25 | return | 7 `[02b #25]` tests (`fix: planOrder groups present` … `stage errors`) | green |
| 26 | comp | 12 `[02b #26]` tests | green |
| 27 | comp | 6 `[02b #27]` tests | green |
| 28 | proj | `[02b #28] live projection = replayed projection over a fixture day` | green |
| 29 | exports, proj | `[02b #29 exports] merge T2 into T1: the absorbed order is in the surviving seating totals and ordersOf`, `[02b #29 fold] OrdersBilled sets billed_at on every listed order` | green for `seatingTotals`, `ordersOf`, `billed_at`; **GAP**: `seating-orders` and `follow_up` after a merge are not asserted |
| 30 | proj, queries | `[02b #30 fold] day close sets day_closed_at only on cancelled, billed or finished orders` (billed dine-in with an untapped line, deal with every part served), `[02b #30 fold] a carried order finished the next day`, `[02b #30 open-orders] a carried takeaway shows`; replay: `[02b #28]` | green |
| 31 | queued + 00 tests (table 3) | 02b's clauses only (AD-2): `[02b #31 02b sent_after_reconnect]`, `[02b #31 02b free lock]`, `[02b #31 02b moved lock]`, `[02b #31 02b not queueable]` ×2 | green; 00 clauses in table 3 |
| 32 | queries, events | `[02b #32] push path`, `[02b #32] catch-up`, `[02b #32] order-contact: view-customer-contact`; `packages/events/src/events/order/order-events.test.ts` `[02b O17] OrderPlaced has no contact field` | green |
| 33 | preview, queries, zstock + per-command files | 6 `[02b #33 preview]`, `[02b #33 queries] seating-orders 2, open-orders 2`, `[02b #33 refill tile]` ×2, `[02b #33 zone audience]`; §6.2–§6.10 counts: remove `[02b §6.2] takeaway statements`, weight `[02b §6.3] statements: 1`, served `[02b §6.4] statements: 2`, rb `[02b #24] no extra read`, `[02b §6.6] statements: 1`, return `[02b §6.7] statements: 2`, comp `[02b #26] allowed → LineComped with the next free shares` ("2 statements"), zstock `[02b §6.9] statements`, submit `[02b #1] dine-in happy path` ("5 statements") | green |
| 34 | perf | `[02b #34 submit] SubmitOrder of 12 lines on the peak engine`, `[02b #34 preview] eta-preview of the same 12-line cart`; also §7's third row `[02b §7 seating-orders]` | **pending run** (AD-4) |
| 35 | apps/client | — | **GAP** (wave 5, blocked on the design handoff) |
| 36 | apps/client | — | **GAP** (wave 5, blocked on the design handoff) |
| 37 | ledger, remove, comp, exports | 4 `[02b #37 pure]`, 3 `[02b #37 remove]`, `[02b #37 comp]`, 3 `[02b #37 totals]` | green |
| 38 | ledger, comp | `[02b #38 pure] remade karahi stays billed`, `[02b #38 comp] remake a karahi → still billed` | green |
| 39 | ledger, remove, comp | 2 `[02b #39 pure]`, `[02b #39 remove]`, `[02b #39 approved]` | green |
| 40 | return | `[02b #40] fix and remake: order_header = the EngineOrder fields`, `[02b #40] takeaway: order_header from the EngineOrder` | green |

### 3. §10 #31 clauses that are 00's (AD-2) → their 00 tests

| #31 clause | 00 test (file, name start) | Status |
|---|---|---|
| Wi-Fi drop 15 min, 5 min TTL → still active, accepted in that name | `auth/idle-pause.int.test.ts` `[00 #152] socket closes, 15 min pass with a 5 min TTL`; 02b half: queued `[02b #31 02b sent_after_reconnect]` | green |
| the idle clock resumes with the time used before the drop | `[00 #152]` (same test: "2 min used before the drop → it ends 3 min after reconnect") | green |
| a pong-timeout terminate pauses at the terminate | — (`[00 #152]` drops the socket with a clean `close()`; the terminate path is only a comment in `src/auth/session-store.ts`) | **GAP** |
| hub restart of 60 s across the TTL → paused from `hub_down_at`, accepted | `[00 #154] hub down 60 s across the TTL` | green |
| paused longer than `queue_auto_send_max_ms` → ended `idle_timeout`, replay → 401 | `[00 #155] M95 cap: device off 5 h`, `[00 M95] the cap is the branch setting engine_settings.queue_auto_send_max_ms`; 401: `commands/idempotency.int.test.ts` `[00 §10 #5] a new command_id after the session ended is 401 SESSION_EXPIRED` ("kept in the log": device, #35) | green (device half GAP #35) |
| `logout` / `taken_over` / `forced` / `credentials_changed` / `hub_restored` / left staff → 401 | `[00 §10 #5]`; end reasons: `auth/staff-session.int.test.ts` `[00 §10 #38] logout is idempotent`, `[00 §10 #35] takeover ends the holder taken_over`, `commands/admin-commands.int.test.ts` `[00 §10 #43] force logout`, `auth/apply-directory.int.test.ts` `[00 §10 #101] a changed pin_hash ends staff and admin sessions credentials_changed`, `[00 §10 #70] removed staff sessions end staff_removed`, `boot/restore.int.test.ts` `[00 §10 #68] cloud-only restore` | green |
| revoked device → `403 DEVICE_REVOKED`, queue kept | `auth/guards-auth.int.test.ts` `[00 §10 #116] DEVICE_TOKEN_INVALID and DEVICE_REVOKED on commands`; `commands/idempotency.int.test.ts` `[00 §10 #85] a revoke committed before the command transaction` (queue kept: device, #35) | green (device half GAP #35) |
| `X-Queued-At` passes the CORS preflight | `cors.int.test.ts` `[00 #158] preflight from a cors_origins origin requesting X-Queued-At` | green |
| tablet off 5 h with the M5 save → ended at 4 h | `[00 #155] M95 cap: device off 5 h with the sweeper running` | green |
| HTTP-only contacts every 10 min for 5 h → ended at 4 h | `[00 #155] M95 cap: HTTP-only contacts every 10 min for 5 h` | green |
| unknown token after restore → `401 SESSION_INVALID`, kept | `auth/guards-auth.int.test.ts` `[00 §10 #117] SESSION_INVALID for another device session` (kept: device, #35) | green (device half GAP #35) |
| "Send again" after a new login; an already-committed order → the stored 2xx (M19) | `commands/idempotency.int.test.ts` `[00 §10 #3] a retransmit after the session ended replays the stored response` (the button and "shown as sent": device, #35) | green (device half GAP #35) |
| the shift is not activity (a socket that only pongs still idles out) | `[00 #156] M95: a connected socket that only pongs still idles out (M59)` | green |
| `X-Queued-At` clamped to `[started_at − 2 min, now]`, ignored on a non-queueable command | `commands/queued-at.int.test.ts` `[00 #157] X-Queued-At on a queueable command`; 02b half: queued `[02b #31 02b not queueable]`, `[02b #22 queued] served_at is the clamped queued_at` | green |
| free lock not taken (P-1b) | 02b's: queued `[02b #31 02b free lock]`, `[02b #31 02b moved lock]` | green |
| request before the socket, then a second drop → still paused (S-1) | `[00 #153] a command arriving over HTTP before the socket, then a second drop` | green |
| hub crash mid-outage → time before the crash not counted (S-2) | `[00 #154] a crash mid-outage does not count the time before the crash` | green |
| an open alert-mode socket keeps the device unpaused (S-6) | `[00 #156] M95: an open alert-mode socket keeps the device unpaused` | green |

### 4. GAPs (no test today)

| # | GAP | Why | Closes with |
|---|---|---|---|
| 1 | §10 #35 (client queue, drafts, device idle lock, late cards by table, queue log, "Send again") | wave 5 blocked (no `docs/design/handoff/02b/`) | task 25 |
| 2 | §10 #36 (stepper, zone-empty flip, slow chip, sold-out update, cart by ETA, table view by time) | same | tasks 26–27 |
| 3 | E2-ADD AC2 screen half (live preview) | client | #36 |
| 4 | E2-ADD AC4 (rounds on the table view) | client | #36 |
| 5 | E2-ETA AC1 screen half (the ≤ 1 s budget is also #34, pending run) | client | #36 (+ owner's `pnpm test:perf`) |
| 6 | E2-ETA AC2 (sorted earliest first on screen) | client | #36 |
| 7 | E2-ETA AC6 (promise on the table view) | client | #36 |
| 8 | E2-SOLD AC1 ("Sold out" label) | client | #36 |
| 9 | E2-SOLD AC2 (slow clock icon) | client only | #36 |
| 10 | E2-SOLD AC3 tile half | client | #36 |
| 11 | E0-ORD AC1 (Hold, device-local) | client | #35 |
| 12 | E5-DEV AC1 (device queue) | client | #35 |
| 13 | E5-DEV AC2 device half (replay order) | client | #35 |
| 14 | E5-DEV AC4 ("Reconnecting…", no "sent" before 2xx) | client | #35 |
| 15 | E5 edge "order in progress preserved" | client | #35 |
| 16 | §10 #29: `seating-orders` and `follow_up` after a merge | hub; the code reads both through 02a `seating_orders` (as `ordersOf` does), but no test asserts them | a hub test, owner's call (not written: task 24 writes no new tests) |
| 17 | §10 #31 (00 clause): a pong-timeout terminate pauses at the terminate | 00; `[00 #152]` uses a clean close only | a 00 test in the next platform batch, owner's call |

Not a GAP: estimated Served (G0-6 fallback, §6.11) is O14, registered when 03b's `Handover` exists; printing of notes (E0-ORD AC2) is 03b; the comp's bill line (C3, E0 AC3 "COMP" label) is 05.

## Wave 4 — perf file, acceptance map, spec v1.0.4 (2026-11-11)

- **Task 24:** `aa4ec9c`.
  - **Perf file:** `apps/hub/test/orders/submit.perf.test.ts`. It times SubmitOrder at 12 lines (p99 < 60 ms), eta-preview (< 40 ms) and seating-orders (< 30 ms), per §7 / #34.
    - Kept out of the gate by the `test/**/*.perf.test.ts` exclude in `apps/hub/vitest.config.ts`; picked up by the `perf-hub` project.
    - Typechecked and linted, but **not run** (AD-4).
  - **Acceptance map:** in the "Acceptance map" section of this board.
  - **README:** 4 carried rows closed and 6 hub halves marked built.
  - **OPEN-QUESTIONS §5:** AD-5 added.
  - **Review:** opus, approved, with 3 minors:
    - the README 02a "To 02b" row still lists `CallWaiter` as open, but §3.12 already settles it (never queued);
    - acceptance AC2 should add `[02b #3]`, and AC5's immutable-log citation is weak;
    - the perf `openDay` comment.
- **Spec v1.0.4 (APPROVED, owner 2026-11-11):** `2589c78`, `7e711f5`.
  - It applies 25 of 26 text-bump items, with 42 "⚠️ Changed by v1.0.4" markers.
  - The one item not applied is AD-36's single rule (see the build review).
  - It also updates the README 02b row and the plan and board Spec lines.
- **Gate:** `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`. 420 files (1 skipped), 4135 tests passed (1 skipped, 1 todo), 579 s wall. Green. The perf file was not executed.
- **GAPs (acceptance map, confirmed by the review):**
  - 15 client-side items: §10 #35 and #36, and the client halves of the E2 / E0 / E5 story ACs. These are wave 5, blocked on the design handoff.
  - **§10 #29:** no test for `seating-orders` / `follow_up` after a merge. The plan placed #29 with only `seatingTotals` / `ordersOf`.
  - **#31, 00 clause:** a missed-pong terminate pausing the idle clock has no test.
- **AD rows:** AD-40 (proposed): the perf cart has no deal and no stock draws.
- **Next:** the owner runs `pnpm test:perf` on the real disk, alone (CLAUDE.md). It may first fail on the fixture setup rather than on time.

## Perf run — owner, 2026-11-11 (G-7)

- **Run:** `pnpm test:perf` on the dev laptop (HP ZBook 15 G2), by the owner, on the real disk.
- **02b's own perf passes:**
  - SubmitOrder p99 28 ms (< 60);
  - eta-preview 6.6 ms (< 40);
  - seating-orders 3.0 ms (< 30).
- **03a `fires_alerts` fails one case at random.** It is **not a 02a / 02b regression**:
  - p50 is flat across `2fa2db0`, `main` and `module-02b`: about 9.5 ms for work and about 15 ms for slips.
  - The baseline `2fa2db0` itself fails the slips case (p99 36 ms).
  - With 31 samples, p99 is the largest sample, so a single GC or fsync spike fails the case.
- **Next platform batch:** raise the sample count (for example to 200+) so p99 is not the max sample. The bound stays unchanged. `docs/OPEN-QUESTIONS.md` §5 has the item.
- **Authoritative run:** stays on the pilot box (03a task 28).
- **G-7 status:** closed for 02b.

## Next

1. **Owner:** the build review's verdict is **ready to merge** (`docs/reviews/02b_v1.0.4_build_review.md` §8, updated at `7bef4c0`). The full gate at the head is green: 420 files, 4142 tests, 581 s. Merging into `main` is the owner's call.
2. ~~Owner: `pnpm test:perf` (G-7)~~ done 2026-11-11: 02b passes; the 03a `fires_alerts` flake goes to the next platform batch ("Perf run" above).
3. **Design (parallel):** `docs/design/handoff/02b/` from the screen list in plan wave 5.
