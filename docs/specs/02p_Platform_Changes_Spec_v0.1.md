# 02p Platform Changes — Module Spec v0.1

| | |
|---|---|
| Doc | Module spec (Module mode, 12 sections), **v0.1 — DRAFT** (2026-11-07). A **build-scope spec**: it adds no rule. It gathers every approved change that 02a Tables v1.1 and 02b Ordering v1.0 made to earlier specs (their §4.5 rows) into **one sprint**, built after 03a and before 02a, so the 02a, 02b and 03b sprints touch only their own domain (owner, 2026-11-07). |
| Source of truth | The bumped specs, not this file: Foundation v1.11, 00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 01d v1.2, 03a v1.1 and 03a v1.2 (written in task 0). Every task cites the row and section it builds. If this file and a bumped spec disagree, the bumped spec wins (CLAUDE.md). |
| Depends on | 03a built and merged (the engine lane's `module-03a`, 03a v1.0 as built); 00, 01a, 01b, 01c, 01d built. |
| Blocks | 02a, 02b, 03b sprints. |
| Rigor | T2 (CLAUDE.md). |

### Changelog

| Version | Change |
|---|---|
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
| 02a | 01a zones, `dining_tables.zone_id`, V4; 01b `take-order`, `clean-table`, `assigned_zone_ids` / `assigned_table_ids`, `StaffDirectory.assignedOrderTaker`, `own_tables`; 01d `table_team` resolver contract (D-1) and `skip_requester` (D-3); 03a Q-1 hook for `holdersOfOrders`, Q-2 key; 00 `queueable` (for `RequestBill`, `CleanTable`) |
| 02b | 00 M95, `ctx.queuedAt`, CORS; 01a zone routes / stock items, `is_ready_item`, settings, comp chips; 01b `set-line-weight`, `manage-zone-stock`, `view-customer-contact`, `my_zones`, scope options, defaults; 01c / 03a `ItemAdded` and `OrderPlaced` additive fields (C-1, E-1); 03a Q-3–Q-6, Q-9 |

### 4.2 Changes to other specs (R26)
None. This spec only builds approved rows. Schedule notes were added to 02a v1.1.1 §11 and 02b v1.0.1 §11 (text only).

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
| U-2 | 01a v2.2 / v2.3 | 01a tests 181–188, 189–195 |
| U-3 | 01b v1.6 | `take-order`, `clean-table` seeded by `default_key`; assignments: one person per zone / table (`already_assigned`); directory v3 carries the lists; `assignedOrderTaker` table → zone → none, only `take-order` holders; `own_tables` resolves to held seatings through a stub reader |
| U-4 | 01b v1.7 | the three permissions in `PERMISSION_CATALOGUE` and `PERMISSION_SCOPES`; `my_zones` = own or lead's zones; `own_tables` accepted on `take-order`, `boost-order`, `mark-item-returned`; defaults: Cashier `set-line-weight`, `view-customer-contact`, `apply-comp` (approval by Manager); Order taker `boost-order`, `view-customer-contact` (`own_tables`), `apply-comp` (approval); `manage-zone-stock` only Owner, Manager; a `scope = 'my_zones'` row inserts after the expand migration; settings `PATCH` accepts and range-checks the new fields |
| U-5 | 01c v1.1.2 | `ItemAdded` schema accepts and requires both fields; an old event without them parses as `null` / `false` |
| U-6 | 01d v1.2 | D-1 (a)–(e): key includes depth, resolver set is the full set with the presence filter, absent-owner marker from `owner_staff_id`; D-3: `skip_requester` drops the requester from every set; startup error on a request kind |
| U-7 | 03a v1.1 | Q-1: receiver = holder of the oldest order through the hook; no hook → `placed_by` (stub); Q-2: `dine_in` key built from a seating id in 03a's tests |
| U-8 | 03a v1.2 | Q-3: zone `ItemAdded` and empty-`order_item_ids` `OrderPlaced` change nothing and log nothing; Q-4: partial `ItemRemoved { units }` releases only the units' share; Q-5: `StockTransferredOut` folds as a negative `StockAdded`, replay = live; Q-6: `ItemServed { source: 'zone' }` no-op, `served_at` → `min(served_at, recorded_at)`; Q-9 / E-1 schema fields round-trip |
| U-9 | Regression | full gate `pnpm -w typecheck && pnpm -w lint && pnpm -w test` green; 03a simulator gate within §7.1 |

### Acceptance
02p is done when U-1–U-9 pass and the 02a and 02b sprints can start without editing a file outside `apps/hub/src/{tables,orders}/`, `apps/client/src/staff/`, their `packages/events` folders and `@pos/domain/src/errors.ts` entries.

---

## §11. Build order (one task per commit, TDD; batches of ~5)

**Batch 0 — spec**
0. Engine lane: write **03a v1.2** (U2) and its review (targeted check); approve. Update README.

**Batch 1 — shared types and schemas**
1. `@pos/events`: 01c C-1 and 03a E-1 additive fields; Q-4 `ItemRemoved.units?`, Q-6 `ItemServed.source` / `served_at?`, Q-9 `ItemVoided` money fields, Q-5 `StockTransferredOut` (U-5, U-8 schema part).
2. `@pos/domain`: 01b permission catalogue and scopes (`take-order`, `clean-table`, `set-line-weight`, `manage-zone-stock`, `view-customer-contact`, `own_tables` options, `my_zones`); 01a / 01b error codes of their rows.

**Batch 2 — 01a**
3. Cloud migration zones + routes + stock items + `is_ready_item` + settings columns; admin routes §6.6a / §6.6b with nested lists (U-2).
4. Snapshot V4 (`zones`, `zone_id`, `routes`, `stock_items`, `is_ready_item`, settings, comp chips); fixtures V3 → V4 once (U5); hub apply.
5. `StockTransferredOut` in `STOCK_VERSION_EVENTS`, stock-frame audience, boot fold lists (01a test 194).
6. Owner app: zones, zone routes and stock items, ready-item checkbox, settings fields (01a tests 189–195 client part).

**Batch 3 — 01b**
7. Assignments (cloud + hub migrations, staff routes, directory v3, `assignedOrderTaker`) (U-3).
8. `my_zones` expand migration and resolver; `own_tables` options; non-table orders rule as a scope helper (U-4).
9. Defaults by `default_key` and the re-seed; settings `PATCH` fields (U-4).
10. Owner app: staff form "Assigned tables" (U-3 client part).

**Batch 4 — 00 and 01d**
11. 00 M95 paused idle clock (guard step, sweeper skip / flush / cap, boot pause from `hub_down_at`) (00 tests 152–156).
12. 00 `X-Queued-At` → `ctx.queuedAt` (clamped, queueable only), `defineCommand({ queueable })`, CORS list (00 tests 157–158).
13. 01d D-1 (`table_team` key with depth, full set, `owner_staff_id`) and D-3 (`skip_requester`) (U-6).

**Batch 5 — 03a (engine lane, against 03a v1.2)**
14. Q-2 key from seating id; Q-1 receiver through a `holdersOfOrders` hook with the `placed_by` fallback (U-7).
15. Q-3 zone lines / empty orders, host `logAbsentIds` filter (U-8).
16. Q-4 partial `ItemRemoved` fold and share release (U-8).
17. Q-5 `StockTransferredOut` fold, replay lists, test 94; Q-6 `ItemServed` fields (U-8).
18. Simulator gate re-run; full regression gate (U-9). README rows closed.

---

## §12. Definition of Done, checklist, questions

### 12.1 Definition of Done
U-1–U-9 green; every task's commit cites its row and section (e.g. `feat(01b): my_zones scope [01b v1.7 B-3; 02p §11 #8]`); README map row 02p "Built"; 02a v1.1.1 and 02b v1.0.1 §11 notes still true.

### 12.2 Checklist (row → task)

| Row | Task |
|---|---|
| F v1.10 F-1–F-3, v1.11 F-1–F-3 | text only; error codes in task 2 |
| 00 v1.8 H-1 | 11, 12 |
| 01a v2.2 A-1 | 3, 4, 6 |
| 01a v2.3 A-1 | 3–6 |
| 01b v1.6 B-1–B-3 | 2, 7, 8, 9, 10 |
| 01b v1.7 B-1–B-5 | 2, 8, 9 |
| 01c v1.1.2 C-1 | 1 |
| 01d v1.2 D-1, D-3 (D-2 text) | 13 |
| 03a v1.1 Q-1, Q-2 | 14 |
| 03a v1.2 Q-3–Q-6, Q-9, E-1 (Q-8 text) | 1, 15–17 |

### 12.3 Open questions

| # | Question | Default until answered |
|---|---|---|
| UQ1 | (developer) Does the engine lane run batch 5, or the platform lane? | the engine lane (U2) |
| UQ2 | (developer) Is a G2 completeness check enough for this spec (it adds no rule), or a full G4? | G2 only |
