# 02p Platform Changes — Module Spec v1.0 (APPROVED)

| | |
|---|---|
| Doc | Module spec (Module mode, 12 sections), **v1.0 — APPROVED** (developer as the owner's proxy, 2026-11-07) after hostile run 1 (`docs/reviews/02p_v0.1_hostile_run1.md`, §12.4) and the targeted check (`docs/reviews/02p_v0.2_targeted_check.md`, §12.5). Not yet built: starts after 03a is built and merged. A **build-scope spec**: it adds no rule. It gathers every approved change that 02a Tables v1.1 and 02b Ordering v1.0 made to earlier specs (their §4.5 rows) into **one sprint**, built after 03a and before 02a, so the 02a, 02b and 03b sprints touch only their own domain (owner, 2026-11-07). |
| Source of truth | The bumped specs, not this file: Foundation v1.11, 00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 01d v1.2, 03a v1.1 and 03a v1.2 (written in task 0). Every task cites the row and section it builds. If this file and a bumped spec disagree, the bumped spec wins (CLAUDE.md). |
| Depends on | 03a built and merged (the engine lane's `module-03a`, 03a v1.0 as built); 00, 01a, 01b, 01c, 01d built. |
| Blocks | 02a, 02b, 03b sprints. |
| Rigor | T2 (CLAUDE.md). |

### Changelog

| Version | Change |
|---|---|
| v1.0 | **APPROVED.** Text of v0.2 with the targeted-check wording fixes; UQ1, UQ2 take their defaults (engine lane runs batch 5; G2-level review was enough). |
| v0.2 (targeted-check wording) | `02p_v0.2_targeted_check.md` N-1, n-2–n-8 (§12.5): staff entry files in the acceptance; task 0 patches 02a's stale paths and reader pair; tasks 2, 5, 17 name the tests they update; Urdu to-do list allowed; U-8 deal-header `ItemRemoved` and restart after a checkpoint; U-5 cites 02b tests 2 and 12. |
| v0.2 | Hostile run 1 (`02p_v0.1_hostile_run1.md`) M-1–M-6, m-1–m-9 (§12.4): real file set in the acceptance; Q-1 reader pair incl. the card label; `zonesOf` directory read for `my_zones`; batch 1 adds ranks and client labels; Q-3 filter tests for all four shapes; test 194's boot-fold clause with Q-5; test 193 split; test 187 bound; old-event parsing; `own_tables` stub dropped; scope sets pinned; assignment cases; D-1 (e) is 02a's; task 0 rewords status lines; F-3 codes stay in 02a / 02b. |
| v0.1 | First draft (owner request, 2026-11-07): one sprint for every upstream row of 02a v1.0 / v1.1 and 02b v1.0, including 03a v1.1 and v1.2. |

---

## §1. Header

### 1.1 Stories covered
None directly. Each row serves the story its owning spec cites (02a E2-TBL, 02b E2-ORD / E2-ADD / E5, 03a E4).

### 1.2 In scope (the "platform rows")

| Spec (built module) | Rows | From |
|---|---|---|
| Foundation v1.10, v1.11 | F-1–F-3 (both) | 02a, 02b — **text only**, no code |
| 00 v1.8 | H-1 (M95 paused idle clock, `X-Queued-At`, CORS, `queueable`) | 02b |
| 01a v2.2, v2.3 | A-1 (zones, `zone_id`, snapshot V4) · A-1 (zone item routes, zone stock items, `is_ready_item`, settings, comp chips, `StockTransferredOut` lists) | 02a · 02b |
| 01b v1.6, v1.7 | B-1–B-3 (`take-order`, `clean-table`, assignments, `own_tables`) · B-1–B-5 (`set-line-weight`, `manage-zone-stock`, `view-customer-contact`, `my_zones`, `own_tables` options, defaults, settings fields) | 02a · 02b |
| 01c v1.1.2 | C-1 (`ItemAdded` + `served_from_zone_id`, `is_ready_item`) | 02b |
| 01d v1.2 | D-1 (`table_team` full set, keyed by depth), D-3 (`skip_requester`); D-2 is text | 02a |
| 03a v1.1 | Q-1 (slip receiver = holder of the oldest order via `holdersOfOrders`), Q-2 (`dine_in` key = `'dine_in:' + seating_id`) | 02a |
| 03a v1.2 | Q-3–Q-6, Q-8 (text), Q-9, E-1 | 02b |

### 1.3 Out of scope
- Anything 02a or 02b builds for itself: their events, projections, commands, queries, kinds, error codes (`errors.ts` entries of 02a §9 / 02b §9), clients. **02a v1.1 is 02a's own spec** and is built in the 02a sprint.
- 03b's upstream rows (03b spec not written). Rule for later specs: a domain sprint never edits another module's files; new rows go to the next platform batch (a 02p-style spec) or are listed for approval first.

### 1.4 Decisions

| # | Decision | Why |
|---|---|---|
| U1 | **One sprint, after 03a, before 02a** (owner, 2026-11-07). | Shared files (00 pipeline, 01b catalogue, 01a migrations, 03a engine) change in one lane; one migration batch; one re-seed (R29); one regression run of 00–01d and 03a. |
| U2 | **The engine lane writes 03a v1.2** (task 0) = 03a v1.0 as built (its AD rows) + 02a's v1.1 rows Q-1, Q-2 + 02b's rows Q-3–Q-6, Q-8, Q-9, E-1 (02b G1-1). The 03a tasks of this sprint build against it. | The engine lane knows the as-built code; 03a v1.1 was never on its branches. |
| U3 | **Consumers not yet built are stubbed, not built.** A platform change whose caller is 02a / 02b (e.g. `holdersOfOrders`, the `table_team` resolver data, `queueable` commands) is built behind its registered hook with the fallback its spec names (03a: `placed_by` until 02 registers; 01d: resolver stubs) and tested with a test double. | Build only what the spec asks (CLAUDE.md); 02a registers the real reader. |
| U4 | **Every row ships with a test from its spec**, or from §10 here where the bumped spec lists none. "Field added" is not done. | Changes without a consumer are easy to build wrong. |
| U5 | **Snapshot V4 is one release** with 03a's V3 (01a v2.2 A-1, v2.3 A-1, R29): fixtures move V3 → V4 once, in task 4. | R29. |

---

## §2. Existing architecture that must not change
Everything built in 00, 01a–01d and 03a, except the listed rows. Merged migrations are never edited: every schema change is a **new** forward migration with the next free number at build time (01a v2.2 A-1, 01b v1.6 B-2). API contracts and error codes change only as the rows say.

---

## §3. Domain rules
None new. Each task implements the rule in the cited section. Cross-row rules that only show up when rows meet:
- 00 M95's cap reads 01a v2.3's `queue_auto_send_max_ms`; until a branch config is applied the default 14 400 000 is used.
- 01b `my_zones` reads 01b v1.6 B-2 assignments; `manage-zone-stock` scope `my_zones` with no assignment matches nothing.
- 01a V4 `zones[].routes[]` / `stock_items[]` are delivered but read by no hub code until 02b (U3).
- 03a Q-3 / Q-6 accept `ItemAdded.served_from_zone_id` and `ItemServed.source: 'zone'` from tests; no producer until 02b.

---

## §4. Contracts

### 4.1 What later sprints may rely on after 02p (exact names from the bumped specs)

| For | Ready after 02p |
|---|---|
| 02a | 01a zones, `dining_tables.zone_id`, V4; 01b `take-order`, `clean-table`, `assigned_zone_ids` / `assigned_table_ids`, `StaffDirectory.assignedOrderTaker`, `own_tables`; 01d `table_team` resolver contract (D-1) and `skip_requester` (D-3); 03a Q-1 **reader pair** (`holdersOfOrders` for the receiver, `currentTableOf` for the card label; registration name fixed in 03a v1.2, task 0), Q-2 key; 00 `queueable` (for `RequestBill`, `CleanTable`) |
| 02b | 00 M95, `ctx.queuedAt`, CORS; 01a zone routes / stock items, `is_ready_item`, settings, comp chips; 01b `set-line-weight`, `manage-zone-stock`, `view-customer-contact`, `my_zones` with the read **`StaffDirectory.zonesOf(staff_id)`** (the person's assigned zones ∪ their lead's, at this branch, in memory, like `stationsOf`), scope options, defaults; 01c / 03a `ItemAdded` and `OrderPlaced` additive fields (C-1, E-1); 03a Q-3–Q-6, Q-9 |

### 4.2 Changes to other specs (R26)
None. This spec only builds approved rows. Schedule notes were added to 02a v1.1.1 §11 and 02b v1.0.1 §11 (text only). Task 0 also makes text-only status patches (m-8): the status lines of 01a v2.3, 01b v1.7, 01d v1.2, 03a v1.1 and the README rows 00, 01d that still say "built with 02a / 02b / 03a" → "built in 02p"; one export line in 01b §4.2 for `zonesOf` (B-3 already defines the rule, M-3); 02a v1.1.1 :262, :655, :675 paths → the acceptance paths (`packages/events/src/events/table/`, `apps/client/src/features/staff/tables/`) (n-2); 02a :654 registers the reader pair `holdersOfOrders` **and** `currentTableOf` (n-3).

---

## §5. Data model
Forward migrations only (numbers = next free at build time):

| Migration | Rows |
|---|---|
| cloud `NNNN_zones.sql` | 01a v2.2 A-1 `zones`, `dining_tables.zone_id`; 01a v2.3 A-1 `zone_item_routes`, `zone_stock_items`, `menu_items.is_ready_item`; `branch_engine_settings` new columns |
| cloud `NNNN_assignments.sql` | 01b v1.6 B-2 assignments |
| cloud + hub `NNNN_scope_my_zones.sql` | 01b v1.7 B-3 CHECK expand on both `scope` columns |
| hub (01b) | hub copy of the assignments (01b v1.6 B-2, directory v3) |
| re-seed | 01b v1.6 B-1, v1.7 defaults by `default_key` (R29) |

00 v1.8 and 03a add no table (in-memory state, event fields).

---

## §6. Commands, endpoints, events
Changed only as the rows say: 01a zone routes (§6.6a, §6.6b; v2.3 nested lists), 01b staff routes (assignments) and settings `PATCH` (new fields), 00 command route (`X-Queued-At`, `queueable`), 01c / 03a event schemas (`ItemAdded`, `OrderPlaced`, `ItemRemoved.units`, `ItemServed.source` / `served_at`, `ItemVoided` money fields, `StockTransferredOut`). No new endpoint.

---

## §7. Cross-cutting
- **Regression gate:** every existing test of 00, 01a, 01b, 01c, 01d and 03a stays green after each batch; the 03a simulator gate (§7.1 of 03a) is re-run after the 03a batch (Q-3, Q-4 touch folds and stock).
- **Replay identity:** 03a test 94 (replay = live) with `StockTransferredOut`; `ENGINE_STATE_VERSION` unchanged (02b §4.5 Q row note).
- **Release:** V3 and V4 ship together (U5); re-seed once (R29).

---

## §8. Client contract
Owner app (`apps/client`, entry `owner`) only, as the bumped 01a / 01b specs say: zones on the floor screen; per-zone routes and zone stock items; the item form's "Ready item (not cooked)" checkbox; branch settings fields; the staff form's "Assigned tables". No staff-tablet screen here (02a / 02b own them).

---

## §9. Error catalogue additions
None new. 01a v2.2's `ZONE_NOT_FOUND` (404) and the 01b `422 CONFIG_REFERENCE_INVALID` reasons are built with their rows. 02a / 02b codes stay in their sprints.

---

## §10. Tests
The bumped specs' tests, plus the verification tests below where a row lists none.

| # | Area | Test |
|---|---|---|
| U-1 | 00 v1.8 | 00 tests 152–158 |
| U-2 | 01a v2.2 / v2.3 | 01a tests 181–188, 189–195, with three placements: test 187's bound is "+1" after task 4 and **"+2" after task 7** (assignments read, m-2); test 193 is split — "delivered with defaults" in task 4, "written, range-checked" in task 9 (m-1); test 194's "boot fold counts it" clause runs in task 17 with Q-5 (M-6) |
| U-3 | 01b v1.6 | `take-order`, `clean-table` seeded by `default_key`; assignments (rule 7): one person per zone / table (`already_assigned`), another branch's zone → `wrong_branch`, archived → `archived`; an archived zone drops out of the directory; a leaver frees their assignments; an assignee without `take-order` is stored but `assignedOrderTaker` ignores them; directory v3 carries the lists; `assignedOrderTaker` table → zone → none (m-6). `own_tables` checks are 02a / 02b tests (02a 46, 02b 23, 32; m-4) |
| U-4 | 01b v1.7 | the three permissions in `PERMISSION_CATALOGUE`; **`PERMISSION_SCOPES` equals 01b v1.7 §3.3's table exactly** for `take-order`, `clean-table`, `mark-served`, `boost-order`, `mark-item-returned`, `set-line-weight`, `manage-zone-stock`, `view-customer-contact` (m-5); `zonesOf`: own zones, lead's zones, no assignment → empty, leaver → empty (M-3); `my_zones` rank as 01b's resolve order; `own_tables` accepted on `take-order`, `boost-order`, `mark-item-returned`; defaults: Cashier `set-line-weight`, `view-customer-contact`, `apply-comp` (approval by Manager); Order taker `boost-order`, `view-customer-contact` (`own_tables`), `apply-comp` (approval); `manage-zone-stock` only Owner, Manager; a `scope = 'my_zones'` row inserts after the expand migration; settings `PATCH` accepts and range-checks the new fields |
| U-5 | 01c v1.1.2 | `ItemAdded` schema accepts both fields; an event without them parses as `null` / `false` (every logged event and fixture still parses); the producer (02b) always sets them, 02b tests 2 and 12 (m-3, n-8) |
| U-6 | 01d v1.2 | 01d test 25 as changed, D-1 (a)–(d) with a fake resolver (`registerTargetResolver`): key includes depth, the resolver set is the full set with the presence filter, absent-owner marker from `owner_staff_id`, `ResolvedTarget.owner_staff_id`; D-1 (e) is 02a test 21 (m-7); D-3: `skip_requester` drops the requester from every set; startup error on a request kind |
| U-7 | 03a v1.1 | Q-1 with test doubles for the reader pair: receiver = holder of the **oldest** order; two holders (split then handover) → the oldest order's holder; card `display.table_code` from `currentTableOf`, never from `table_key`; takeaway / parking stay `placed_by`; no reader registered → `placed_by`, no label; statement bound ≤ 1 `holdersOfOrders` + ≤ 1 `currentTableOf` per pass (03a v1.1 :878, :1151) (M-2). Q-2: `dine_in` key built from a seating id in 03a's tests |
| U-8 | 03a v1.2 | Q-3: zone `ItemAdded` and empty-`order_item_ids` `OrderPlaced` change nothing and log nothing; **host filter for all four shapes** — `ItemServed { source: 'zone' }` on a zone line, `ItemRemoved` on a zone line **and on a `deal` header** (n-6), `ItemVoided` on a zone line and on a `deal` header → no warn line, live, on full replay, and **after a restart whose replay starts at a checkpoint** with an order carried over the day close (id set source per 03a v1.2, n-7) (M-5); Q-4: partial `ItemRemoved { units }` releases only the units' share; Q-5: `StockTransferredOut` folds as a negative `StockAdded`, replay = live; Q-6: `ItemServed { source: 'zone' }` no-op, `served_at` → `min(served_at, recorded_at)`; Q-9 / E-1 schema fields round-trip, and an `OrderPlaced` / `ItemVoided` without the new fields still parses (m-3) |
| U-9 | Regression | full gate `pnpm -w typecheck && pnpm -w lint && pnpm -w test` green; 03a simulator gate within §7.1 |

### Acceptance
02p is done when U-1–U-9 pass and the 02a and 02b sprints can start editing **only**:
- their own folders: `apps/hub/src/{tables,orders}/`, `apps/hub/test/{tables,orders}/`, `apps/client/src/features/staff/{tables,orders}/` (and their tests), `packages/events/src/events/table/` (02a, and 02b's zone events) and 02b's new files in `packages/events/src/events/order/`;
- **append-only registration lines** in shared wiring: the module's `register…` call in `apps/hub/src/server.ts`, its exports in `packages/events/src/index.ts`, a new migration file in `apps/hub/src/db/migrations/`, its strings in `apps/client/src/i18n/{en,ur}.ts`, its route branch and nav entry in 01d's staff entry `apps/client/src/features/staff/StaffApp.tsx` (and 02a §8 Login's change in `StaffApp.tsx`, `SignIn.tsx`, `api.ts`) (N-1), its codes in `@pos/domain/src/errors.ts` and 02a's `TableState` in `@pos/domain`;
- spec text (Foundation §6.2 append, README rows).

Any other edit in 00, 01a–01d or 03a files is a 02p miss.

---

## §11. Build order (one task per commit, TDD; batches of ~5)

**Batch 0 — spec**
0. Engine lane: write **03a v1.2** (U2), including the registration name of the Q-1 reader pair (`holdersOfOrders`, `currentTableOf`); targeted check; approve. Text-only patches of §4.2 (status lines, README rows, 01b §4.2 `zonesOf` export line, 02a paths and reader pair; m-8, M-3, n-2, n-3). 03a v1.2 also states where the Q-3 id set comes from at boot when replay starts after a checkpoint (n-7). Update README.

**Batch 1 — shared types and schemas**
1. `@pos/events`: 01c C-1 and 03a E-1 additive fields; Q-4 `ItemRemoved.units?`, Q-6 `ItemServed.source` / `served_at?`, Q-9 `ItemVoided` money fields, Q-5 `StockTransferredOut` (U-5, U-8 schema part).
2. `@pos/domain`: 01b permission catalogue and scopes (`take-order`, `clean-table`, `set-line-weight`, `manage-zone-stock`, `view-customer-contact`, `own_tables` options, `my_zones`); 01a's `ZONE_NOT_FOUND`. **Same commit, so batch 1 stays green (M-4):** `my_zones` in the hub `SCOPE_RANK` (`auth/staff-directory.ts`) and the client `WIDTH` (`features/owner/staff/people.ts`) with 01b's rank; `perm.<key>` for the five permissions, `staff.scope.my_zones`, `roles.scope.my_zones`, `errors.reference.already_assigned` in `i18n/en.ts` and in `ur.ts` or 01b's Urdu to-do list (`i18n.test.ts:121-124`, n-5). Same commit updates `permissions.test.ts:47-61` ("only `mark-served` offers `own_tables`") to 01b v1.7 §3.3 (U-4 scope-set clauses; n-4).

**Batch 2 — 01a**
3. Cloud migration zones + routes + stock items + `is_ready_item` + settings columns; admin routes §6.6a / §6.6b with nested lists (U-2).
4. Snapshot V4 (`zones`, `zone_id`, `routes`, `stock_items`, `is_ready_item`, settings, comp chips); fixtures V3 → V4 once (U5); hub apply (01a tests 187 "+1", 188, 192, 193 "delivered with defaults").
5. `StockTransferredOut` in `STOCK_VERSION_EVENTS` (`sync/stock-version.ts`) and the stock-frame audience (`ws/restaurant-audiences.ts`) (01a test 194, first two clauses); updates `boot.int.test.ts:450` ("nine types") in the same commit (n-4). The boot fold list is the engine's `ENGINE_REPLAY_EVENTS.stock`: task 17 (M-6).
6. Owner app: zones, zone routes and stock items, ready-item checkbox, settings fields (01a tests 189–195 client part).

**Batch 3 — 01b**
7. Assignments (cloud + hub migrations, staff routes, directory v3, `assignedOrderTaker`) (U-3); 01a test 187's bound → "+2" and 01b's directory bound row in the same commit (m-2).
8. `my_zones` CHECK expand migration (cloud + hub) and **`StaffDirectory.zonesOf(staff_id)`** (own ∪ lead's assigned zones at this branch, in memory) (U-4, M-3). No `own_tables` reader or non-table-order helper: those checks are 02a / 02b's (m-4).
9. Defaults by `default_key` and the re-seed; settings `PATCH` fields (U-4; 01a test 193 "written, range-checked", m-1).
10. Owner app: staff form "Assigned tables" (U-3 client part).

**Batch 4 — 00 and 01d**
11. 00 M95 paused idle clock (guard step, sweeper skip / flush / cap, boot pause from `hub_down_at`) (00 tests 152–156).
12. 00 `X-Queued-At` → `ctx.queuedAt` (clamped, queueable only), `defineCommand({ queueable })`, CORS list (00 tests 157–158).
13. 01d D-1 (`table_team` key with depth, full set, `owner_staff_id`) and D-3 (`skip_requester`) (U-6).

**Batch 5 — 03a (engine lane, against 03a v1.2)**
14. Q-2 key from seating id; Q-1 receiver **and card label** through one registered reader pair (`holdersOfOrders`, `currentTableOf`), fallback `placed_by` / no label; the tick's statement bound (U-7, M-2).
15. Q-3 zone lines / empty orders, host `logAbsentIds` filter with the id set for zone lines and `deal` headers, all four event shapes (U-8, M-5).
16. Q-4 partial `ItemRemoved` fold and share release (U-8).
17. Q-5 `StockTransferredOut` fold, `ENGINE_REPLAY_EVENTS.stock` and `ReplayEventType`, test 94, and 01a test 194's "boot fold counts it" clause (M-6); updates `state.test.ts:208` (replay list) in the same commit (n-4); Q-6 `ItemServed` fields (U-8).
18. Simulator gate re-run; full regression gate (U-9). README rows closed.

---

## §12. Definition of Done, checklist, questions

### 12.1 Definition of Done
U-1–U-9 green; every task's commit cites its row and section (e.g. `feat(01b): my_zones scope [01b v1.7 B-3; 02p §11 #8]`); README map row 02p "Built"; 02a v1.1.1 and 02b v1.0.1 §11 notes still true.

### 12.2 Checklist (row → task)

| Row | Task |
|---|---|
| F v1.10 F-1–F-3, v1.11 F-1–F-3 | text only; F-3 codes are 02a's / 02b's (their step 2 / step 1); task 2 adds only 01a's `ZONE_NOT_FOUND` (m-9) |
| 00 v1.8 H-1 | 11, 12 |
| 01a v2.2 A-1 | 3, 4, 6 |
| 01a v2.3 A-1 | 3–6, 9 (test 193 write), 17 (test 194 boot fold) |
| 01b v1.6 B-1–B-3 | 2, 7, 8, 9, 10 |
| 01b v1.7 B-1–B-5 | 0 (`zonesOf` text), 2, 8, 9 |
| 01c v1.1.2 C-1 | 1 |
| 01d v1.2 D-1, D-3 (D-2 text) | 13 |
| 03a v1.1 Q-1, Q-2 | 14 |
| 03a v1.2 Q-3–Q-6, Q-9, E-1 (Q-8 text) | 1, 15–17 |

### 12.3 Open questions

| # | Question | Default until answered |
|---|---|---|
| UQ1 | (developer) Does the engine lane run batch 5, or the platform lane? | **Closed at approval:** the engine lane (U2) |
| UQ2 | (developer) Is a G2 completeness check enough for this spec (it adds no rule), or a full G4? | **Closed:** one hostile run and a targeted check were done |

### 12.4 Hostile run 1 closure (`02p_v0.1_hostile_run1.md`, APPROVE WITH FIXES)

| # | Fix |
|---|---|
| M-1 | Acceptance lists the real file set: own folders + append-only wiring lines (§10 Acceptance) |
| M-2 | Q-1 reader pair incl. `currentTableOf` card label; registration name in 03a v1.2 (task 0, 14; U-7; §4.1) |
| M-3 | `StaffDirectory.zonesOf` built in task 8; 01b §4.2 export line in task 0; U-4 |
| M-4 | Task 2 adds `SCOPE_RANK`, `WIDTH`, five `perm.*` labels, scope labels, `already_assigned` reason label |
| M-5 | U-8 Q-3 filter tests for all four event shapes; task 15 |
| M-6 | Test 194's boot-fold clause moved to task 17 |
| m-1 | Test 193 split between tasks 4 and 9 |
| m-2 | Test 187 bound "+2" in task 7 |
| m-3 | U-5 / U-8: old events parse; producer sets the fields |
| m-4 | `own_tables` stub reader and scope helper dropped |
| m-5 | U-4 pins `PERMISSION_SCOPES` to 01b §3.3 |
| m-6 | U-3 adds the four assignment cases |
| m-7 | U-6 cites 01d test 25; D-1 (e) is 02a test 21 |
| m-8 | Task 0 rewords stale "built with 02a / 02b / 03a" status lines (§4.2) |
| m-9 | §12.2 F row: F-3 codes stay with 02a / 02b |

### 12.5 Targeted check closure (`02p_v0.2_targeted_check.md`, APPROVE WITH WORDING FIXES)

| # | Fix |
|---|---|
| N-1 | Acceptance adds 01d's staff entry files (`StaffApp.tsx` route + nav; 02a Login in `StaffApp.tsx`, `SignIn.tsx`, `api.ts`) as append-only |
| n-2 | Task 0 patches 02a v1.1.1 :262, :655, :675 paths |
| n-3 | Task 0 patches 02a :654 to register both readers |
| n-4 | Tasks 2, 5, 17 name the tests they update (`permissions.test.ts`, `boot.int.test.ts`, `state.test.ts`) |
| n-5 | Urdu labels in `ur.ts` or 01b's Urdu to-do list |
| n-6 | U-8 adds `ItemRemoved` on a `deal` header |
| n-7 | 03a v1.2 states the boot source of the Q-3 id set; U-8 restart-after-checkpoint case |
| n-8 | U-5 cites 02b tests 2 and 12 |
