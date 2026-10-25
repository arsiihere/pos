# 01a — Restaurant Setup (restaurant data + config delivery) — Module Spec v0.6.1

## §1. Header

| Field | Value |
|-------|-------|
| Module | 01a Restaurant Setup: restaurant data and config delivery. 01b (staff and role admin) is a separate spec; its scope is listed in §12.5 |
| Version | v0.6.1 — **DRAFT** (2026-10-25). **v0.6.1 over v0.6 (editorial addition):** the browser-safe import rule for `packages/engine` and the root of `packages/domain` (S35 k), enforced by lint, test 127. v0.6: Hostile review 1 (`docs/reviews/01a_spec_review_1.md`) applied; the plan is re-baselined after the owner visit (§12.6). v0.6 over v0.5: **scope cut** (owner decisions on the review's cut candidates): the `config_epoch` (S29 a/b), the directory resend (S36), the 00 v1.3 `allowNotNewer` change, `epoch_changed_at` and its banner are removed and replaced by the cloud CLI `restore-bump` (S42); the multi-version snapshot negotiation of S28 (b, e, `SNAPSHOT_SCHEMA_MIN_SERVED`, `SNAPSHOT_SCHEMA_UNSUPPORTED`, `upgrade_required`) is removed, leaving one schema version with additive optional fields (S28); `POST /admin/config/pull-now` is removed (S24, §6.20); the `--business-day-start` CLI option is removed (S33). These cuts also close review findings B1, S-2 and S-8. **Parking** is an order type again (F §5.9, E2 AC9), not a floor (S10). **Review fixes:** a failed apply is visible and each part is retried alone (S43, B2); the hash covers the exact wire JSON (S27, S-1); stock counts are valid for one business day [ASSUMPTION] (S41, S-3); every confirmed count appends `StockSet` (§6.17, S-4); `on_hand < reserved` carried to 03a (S14, S-5); archived tax classes and programs stay in the snapshot and order lines copy program cook times (S22, §4.4, S-6); tenant-level writes need an owner who covers every branch (S8, S-7); boot placement of the stock fold and the config load (S15, S-9); on-site release outside service hours (S39, §7.8, S-10); happy-path and merged-row tests (S-11); idempotency request hash and prune (S7, S-12); review nits 1–10 (§6.1, §5.1, §6.14, S35 j, S21, §12.1, §4.3, §7.3). `businessDayStartedAt` moves to `@pos/domain` (S33, S41). Assumption isolation listed in §12.7. Removed test numbers: 55, 96–101, 109–112 (not reused); new tests 114–126. 24 endpoints. v0.5 over v0.4: plan-review decisions S40 (N1–N12 of `docs/reviews/01a_plan_review.md` follow-up: `@types/node` dev dependency in `packages/domain`; `onBranchConfigApplied(prev, next, tx)`; D54 exception for the tenant-wide bump; poll outcome `not_ready`; `pull-now` answers `200` for every hub-decided outcome; S25 line 8; money parsing drops commas; `set_at` in the stock result; `QueryCtx.branchConfig`; performance targets checked by runbook; automated and runbook parts of tests 75, 102, 103, 104 (all parts automated); first-boot replay risk); S35 confirmed by the owner, with limits: one Vite app with one entry per surface, a closed dependency list, no router/state/form library or CSS framework, styling from `packages/ui-kit` only, shared components in `src/components/` for 02 to reuse (S35 a, d, g, i); S20 removed (S35 is the only page pattern for 01a and later client work); client build and hub/cloud release specified (S39, §7.8, plan review #18); test 113. v0.4 over v0.3: owner pages and `/admin/stock` are React entries in `apps/client` built with Vite (S35, supersedes S20 for 01a's pages); `rotate-config-epoch` also forces a staff-directory resend (S36, closes Q4); `GET /v1/admin/branches` confirmed in 01b (S37, closes Q3); Q1 waits for owner question 8 (S38); tests 109–112. v0.3 over v0.2: snapshot schema versioning, with the hash checked over the raw JSON (S28); `config_epoch` against version regression after a cloud restore, with visible poll problems (S29); "Off since" for availability carried across days (S30); tax rate resolved at bill close (S31); [ASSUMPTION] `out_of_stock_behaviour` (S32) and `business_day_start_ms` (S33); optional tax: nullable `tax_class_id` and `branches.tax_enabled` (S34); both branch settings set by the CLI `set-branch-settings` in 01a, owner endpoint in 01b (§6.7); owner questions merged (§12.6); tests 94–108. v0.2 over v0.1: endpoint count corrected; S10 override of the E1 station-name edge case; WS pushes and catch-up parts (§4.5); cloud `config_audit` (S26); `canonicalJson` / `sha256hex` in `@pos/domain/hash` (S27); `set_at` in the stock slice (S14); 00 drift decided (S25); permission/audit table (§6.0); tests 80–93 |
| Date | 2026-10-25 |
| Depends on | Foundation Spec v1.7 (APPROVED — FINAL); 00 Hub Platform & Access v1.2 (APPROVED; implemented except §10 #79) |
| Inherits | **Shared Standards from Foundation v1.7 §6**, unchanged except where a decision in §3.1 names the section it overrides (D64) |
| Tier | T2 Production (foundation §1) |
| Milestone | A (pilot, 2026-12-20). 01a is on the critical path to 03a and 02. 01b is also required for milestone A, before the first live order (S2) |

### Stories covered

| Story | ACs covered here | Elsewhere |
|---|---|---|
| E1 Floors, tables, and stations | 1, 2, 3 (narrowed by S9, S10), 3 batch programs, 4, 5, 6 (data part: archived station stays in the snapshot) | 3 live capacity override (D37) → 03a; 6 and edge case "warn admin about in-flight tickets" → 03b (§12.4) |
| E1 Menu item recipe route | 1, 2, 4 (narrowed by S11), 5 | 3 modifiers → 01b scope list (S12) |
| E1 Pre-cooked stock — daily entry | 1, 2 (manager view), 6 | 2 (ordering screen countdown) → 02; 3, 4, 5 (reservation, first-submit-wins, slow mode) → 03a / 02; 5 for `sold_out` items narrowed by S32 [ASSUMPTION] |
| E0 Categories, items, variants, add-ons, combos | 1, 2 (no image, S13), 3 (stock time, with E1 route AC2), 7, 8 (tax class on the item, **optional**: overridden by S34); edge case zero-price item | 4, 5, 6 → 01b scope list (S12); per-item tax calculation → 05 |
| E0 Item availability | 1, 2 (data for it), 3 (data for it) | 4, 5 scheduling → 01b scope list; greyed-out display and rejection at order → 02 |
| E0 Staff — PIN login | — | 1 (duplicate PINs rejected) **dropped** by 00 M27: duplicates are allowed, because salted hashes make detection impossible; 7 → 01b |
| Carried requirements | 00 §4.2 `registerStationValidator` (M31); cloud `idempotency_keys` (M69); BYOD exit revoke runs through 01a's pull (R14, M38) | Staff/role admin, PIN, lockout notice → 01b |

### In scope
- Cloud canonical restaurant data: floors, tables, stations, batch programs, tax classes, categories, menu items, and per-branch item routes (§5.2).
- Cloud owner pages for that data (§8.1) and the hub page `/admin/stock` (§8.2), as React entries in `apps/client` (S35).
- The cloud `idempotency_keys` store for every creating `POST` (S7).
- The cloud `config_audit` trail for every owner config write (S26).
- Config delivery: `GET /v1/sync/config` with a conditional `304`; the hub poller; the `BranchConfigApplied` event with a content-addressed snapshot store; the staff directory delivered by the same poll through 00's `applyStaffDirectory` (S3–S6).
- Hub: `registerStationValidator`; the in-memory branch config; pre-cooked stock entry (`StockSet`) and the stock slice of the engine fold (S14, S15); the manual item availability toggle (S17); one hub admin page for stock and availability (§8.2).
- **Staff in dev and test come only from `seed-tenant` (00 §6.26) until 01b ships.** 01a reads staff only through the directory that 00 already builds.

### Out of scope
- Staff/role admin, PIN set/reset, staff-to-branch assignment, the last-admin guard, the owner lockout notice → **01b** (§12.5).
- Live station capacity override (D37), `StockReserved` / `StockReleased`, ETA recalculation on a stock change (D23), and the engine's reaction to a station config change → **03a**.
- Table state, the table map, order lines, the ordering-screen stock countdown, unavailable items shown greyed out → **02**. **Parking** is an order type with no table and an optional car description / spot text (F §5.9, E2 AC9), owned by 02 (S10).
- Tax arithmetic, rounding, resolving the rate at bill close and payment-method tax rules → **05** (S31, S34). 01a stores only an optional tax class, its rate, and the branch's `tax_enabled` flag.
- Owner endpoint for branch settings (`tax_enabled`, `business_day_start_ms`) → **01b**, with `GET /v1/admin/branches` (§12.5). In 01a, `tax_enabled` is set only through the CLI `set-branch-settings`, and `business_day_start_ms` keeps its 05:00 default (S33).
- A "Get changes now" button and snapshot schema negotiation between cloud and hub versions (cut in v0.6, §12.4). Cloud restore itself is 06's; 01a provides only the `restore-bump` CLI (S42).
- Drag-and-drop floor canvas, table shape and position (S9); item images (S13); modifiers, add-ons, combos (S12); scheduled availability; per-branch prices.

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Cloud owns the menu catalogue, prices, station routes and roles; the hub caches them read-only | F §3.1, §3.3 |
| Hub owns live pre-cooked stock and item availability (D26, D50) | F §3.1 |
| Single stock authority: stock exists only as `StockSet` / `StockReserved` / `StockReleased` events and the one engine projection; no SQL stock table | F §3.1, D50 |
| Config snapshot per order: `OrderPlaced` copies each item's route, price and tax class (D25) | F §3.3 |
| Money is integer `_minor` (`BIGINT` on the cloud, `INTEGER` on the hub) | F §4.1, D47 |
| Events are immutable, written only through `writer.run`, commit then swap | F §4.1, D45, 00 §4.2 |
| Fixed hub command order; queries never write | F §6.3 |
| Cloud tenant guard, repositories, route-inventory and cross-tenant tests; tenant-level tables per M16 | F §3.4, D54, 00 M16, M25 |
| Directory rules: forward-only versions (M51), skip bad rows (M52, M75), PIN change ends sessions (M50), removed owner's phone revoked (M38) | 00 §3.1 |
| Station binding through `registerStationValidator`; KDS pairing fails with `STATION_NOT_FOUND` until it is registered | 00 M31, §4.2 |
| UI kit and its content rules | 00 M81, M82; `packages/ui-kit/README.md` |

**Drift between spec 00 and its code (code wins). Same behaviour, so it is fixed by the 00 v1.2.1 editorial patch (S25):**

| Spec 00 v1.2 says | Code has | 01a uses |
|---|---|---|
| §4.2 line 481: `registerReducer` `(state, event) => state`, folded by the writer and by replay | `state.setReducer(reducer)` on the state holder (`engine-host/state-holder.ts`). Same signature; one reducer, and a second call replaces it; the writer folds it inside the transaction (`engine-host/writer.ts:79`); replay does not exist yet in either (03a). The identity reducer is set at `lib/boot.ts:279` and `setup/issue-admin-bootstrap.ts:45` | `state.setReducer(applyEvent)` from `@pos/engine` in place of the identity reducer at `lib/boot.ts:279` (S15) |
| §4.2 line 472: `defineQuery` … `handle(ctx)`; "`ctx.db` is a read-only connection" | `QueryCtx = { db, page, directory, device, session }` (`queries/registry.ts:12`) | — (01a's own `state` and `branchConfig` fields are an additive change owned by 01a, S16, not drift) |

Not drift: F §6.9 lists `packages/engine/src/`; the package does not exist yet. 01a creates it with the stock slice only (S15), and 03a fills the rest.

**Additive change to 00's boot code, owned by 01a (S15, not drift):** step-3 handlers registered with `registerBootStep('3')` receive `BootContext = { config, db, app? }` (`lib/boot.ts:36–40`) and run at `lib/boot.ts:122`, **before** `createDeps` creates the state holder with `{}` (`lib/boot.ts:278`). A step-3 fold therefore has nowhere to put its result today. 01a adds `initialState?: unknown` to `BootContext`; its step-3 handler sets it, and `createDeps` takes it (`createStateHolder(ctx.initialState ?? {})`). Spec 00 behaviour does not change: with no handler, the state is `{}` as before.

---

## §3. Domain rules

### 3.1 Module decisions

Each decision states the failure it prevents and any foundation or 00 section it overrides.

| # | Decision | Prevents / reason | Overrides |
|---|---|---|---|
| S1 | **01 is split into 01a (this spec) and 01b (staff and role admin).** All of 01 in one spec is about 32 endpoints/commands, over the split threshold (README size budget). 01a holds what 02 and 03a build on. 01b writes only 00's existing tables (00 §5.2), so it can be built alongside 02. | One oversized spec on the critical path. | README module map (row 01 → 01a, 01b) |
| S2 | **01b is required for milestone A, before the first live order.** Until it ships, staff and PINs exist only through `seed-tenant`, for dev and test. | A pilot with CLI-made staff cannot reset a PIN or remove a fired employee. | README milestones |
| S3 | **Config pull, built in 01, reused by 06.** The hub polls `GET /v1/sync/config` every 60 s (v0.6: no manual "Get changes now", S24). Each 200 carries the **whole** branch snapshot (§4.3) and/or the staff directory. There is no `hub_push_queue` diff queue. | Milestone A has no 06 sync, so without this no menu change, PIN reset or staff removal would reach a hub after provisioning. A whole snapshot (< 200 items, ~60 KB) cannot get out of order, cannot lose a diff, and cannot apply half an edit. | F §3.3 mechanism ("cloud adds a record to `hub_push_queue`; hub fetches it on the next sync poll") |
| S4 | **Conditional GET.** The hub sends `config_version` and `directory_version`. When both equal the cloud's, the cloud answers **`304 Not Modified` with no body**, after one SQL statement (plus the tenant guard's key lookup, §6.1). | The restaurant is on mobile data; a full snapshot every 60 s is ~85 MB a day per branch. | F §6.1 "every response has a body (no 204)", for this route's 304 only |
| S5 | **Applying config is an event.** A new snapshot is applied in one `writer.run`: `INSERT OR IGNORE` the body into `config_snapshots` (content-addressed by `snapshot_hash`, insert-only, triggers block UPDATE and DELETE), append `BranchConfigApplied { config_version, snapshot_schema_version, snapshot_hash, previous_config_version }`, and update the `branch_config` projection. The in-memory config swaps after COMMIT (D45). **How replay gets the body:** the `branch_config` projection keeps `snapshot_hash` from the last `BranchConfigApplied`; boot and replay read the body from `config_snapshots` by that hash. The table is in the hub database, so the USB backup carries it. After a **cloud-only** restore, or a USB restore followed by the cloud tail (F §5.10), the last event's hash may have no body: boot then finds the body missing, the hub treats its `config_version` as 0, and the next poll fetches the current snapshot in full (§3.4 step 2). The hub opens `/auth/*` only after that poll (requirement on 06, §4.4). | A cache write outside the event log would make replay and restore build a different config from the live hub, and audit could not say which menu was live when. Keeping the body out of the payload keeps 60 KB rows out of the immutable log and out of sync traffic. | — |
| S6 | **The staff directory rides the same poll.** If the cloud's `tenants.directory_version` > the hub's, the 200 carries the directory, and the hub calls 00's `applyStaffDirectory(tx, directory, setDirectory)` **in the same `writer.run`** as any config apply; if that transaction fails, each part is retried alone (S43). 01a is the first caller (00 §4.2 lists 06). M50, M51, M52, M75 and the M38 `owner_removed` phone revoke run unchanged; 00's function is called with its existing signature. **Known limit:** while the branch is offline, a removed staff member keeps working on that hub until the next successful poll (§7.6). | Without it the BYOD exit revoke (R14) never fires in the pilot. | 00 §4.2 caller of `applyStaffDirectory` (01a, then 06) |
| S7 | **Cloud `idempotency_keys` (M69).** Every creating `POST` under `/v1/admin/*` requires `Idempotency-Key` (ULID). The key row is inserted **first, in the same transaction as the create**. A concurrent second request with the same key blocks on the primary key until the first commits, then reads the stored response. Same key + same request hash → stored status and body with `Idempotent-Replay: true`. Same key + different hash → `422 IDEMPOTENCY_KEY_MISMATCH`. Only successful responses are stored; a failed request rolls the key back. **Request hash (v0.6):** `request_hash = sha256hex(canonicalJson({ method, path, body }))`, where `path` is the route path with its parameters filled in (e.g. `/v1/admin/branches/<b>/floors`), so the same key on another branch's path is a mismatch, not a replay. **Prune (v0.6):** rows older than 24 h for that tenant are deleted after the create's COMMIT, in their own statement `DELETE FROM idempotency_keys WHERE ctid IN (SELECT ctid FROM idempotency_keys WHERE tenant_id = $1 AND created_at < $2 LIMIT 100 FOR UPDATE SKIP LOCKED)` (index `idempotency_keys_age`). It takes no lock inside the create's transaction, so it is outside S8's lock order and cannot deadlock with another create; a prune failure is logged and does not change the response. | F §6.4: an owner on mobile data retrying "add item" would create duplicates. Inserting first in the same transaction removes the need for an "in progress" state. A body-only hash would replay branch A's floor for a request on branch B. A prune inside the transaction would serialise every create on the same old rows. | — |
| S8 | **Version bumps.** Every cloud config write bumps `branches.config_version` in the same transaction: the edited branch for branch-level data (floors, tables, stations, programs, routes), **every branch of the tenant** for tenant-level data (tax classes, categories, items). `UPDATE … RETURNING` also serialises concurrent config writes per branch. Lock order: the target row, then reference rows (`FOR SHARE`, in id order), then the branch rows last, in `branch_id` order (the tenant-wide bump first runs `SELECT … ORDER BY branch_id FOR UPDATE`), so two writes cannot deadlock. Directory bumps are 01b's (00 M51). **Tenant-level writes need an owner who covers the whole tenant (v0.6):** the tenant-wide bump's locking `SELECT` already reads every branch of the tenant; if any of them is missing from the JWT's `allowed_branch_ids`, the write fails with `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`, and the transaction rolls back (nothing written, no audit row, no key stored). Branch-level writes keep the `404 BRANCH_NOT_FOUND` path check. | A per-tenant counter would make all three hubs download after a table rename at one of them. An owner limited to branch A (`allowed_branch_ids` can be a subset, `cli/issue-registration-code.ts:68`) must not change prices or archive items at B and C (D30). | — |
| S9 | **Floor editor narrowed:** floors (name, sort order, archive) and tables (name, floor, optional seats, sort order, archive). No canvas, shape or x/y. 02 shows tables as a tile grid per floor in sort order. Nullable `pos_x` / `pos_y` can be added later with a forward-only migration. | Nothing in E2–E8 reads a position; a canvas editor is the largest UI in the module. | E1 AC1 (2D canvas), AC2 (shape, position) — narrowed |
| S10 | **Stations belong to the branch, not to a floor.** Station names are unique per branch; an optional `location_label` ("Ground floor, back") says where it is. **Parking (v0.6, reverts v0.5's parking-as-floor):** parking is an **order type** with no table, as F §5.9 ("takeaway, parking and delivery orders have no table; no lock check") and E2 AC9 ("parking (car description)") say. Its optional car description / spot text is 02's. 01a models no parking data; owner question 1 stays open for 02. | The engine never reads a station's floor. With no floor on a station, "same name on a different floor" has nothing to tell the two apart on a KDS or ticket; the label says where the station is ("Fryer" + "Back kitchen"). | E1 AC3 (station "floor and position") — narrowed; **E1 edge case "two stations with the same name on different floors → allowed" — overridden**: station names are unique per branch (`409 CONFIG_NAME_TAKEN`), and `location_label` says where each station is |
| S11 | **Recipe route is per branch.** The menu (categories, items, prices, tax classes) is tenant-wide; each item has at most one route per branch (`item_routes`: station, and at a batch station a `program_id` and an optional `stock_program_id`). An item with no route at a branch is not sold there and is not in that branch's snapshot. A program is allowed only at a batch station, and a batch station requires one ("batchable" = routed to a batch station with a program). Same menu and prices at all branches [ASSUMPTION, owner question 5]. | Stations are per branch, so a tenant-wide route could point at another branch's fryer. | E1 route AC4 "marked batchable (yes/no)" → derived from the route |
| S12 | **No modifiers, add-ons or combos in 01a.** A variant is its own item ("Chicken Karahi — Half", "— Full") with its own price, route and stock count. An optional `group_label` ("Chicken Karahi") lets 02 show the variants side by side. Paid extras are plain items. Free requests go in 02's kitchen note (§4.4). Modifiers and combos go to the 01b scope list, decided after the owner visit [ASSUMPTION, owner questions 2, 6]. | Modifiers would add an order-line array to `OrderPlaced` before anyone knows whether the pilot menu needs it. | E0 menu AC4–6 deferred |
| S13 | **No item image or description upload in 01a.** `description` is an optional text field; images are deferred. | Uploads need object storage and an extra dependency; the order screen works without photos. | E0 menu AC2 (image) deferred |
| S14 | **Stock shape: on hand, reserved, set at.** `EngineState.stock: Record<ItemId, { on_hand: number; reserved: number; set_at: number \| null }>`, and **available = max(0, on_hand − reserved)**. `StockSet` sets the physical count the manager sees in the pot (`on_hand`), which still includes units reserved for orders not yet served. 01a's fold handles `StockSet` only: `on_hand = count`, `set_at = event.recorded_at` (from the event, so replay gives the same value), `reserved` unchanged (0 for a new item). An item with no entry reads as `{ on_hand: 0, reserved: 0, set_at: null }` (E1 stock AC6). Apart from display, `set_at` is read only by `availableStock`'s business-day rule (S41). 03a's `StockReserved` / `StockReleased` change `reserved`, and the step that hands a unit over moves it out of both. Everywhere F §4.7 says "pre-cooked stock > 0", it means `availableStock(state, itemId, businessDayStartMs) > 0` (S41). **Invariant (v0.6):** `on_hand ≥ 0` and `reserved ≥ 0` always; no fold step may take either below 0. **A count below the reserved units** (`StockSet` with `on_hand < reserved`, e.g. `{ on_hand 5, reserved 5 }` then a count of 3) leaves `reserved` unchanged and `available` 0 in 01a; 03a re-plans the excess reservations (§4.4). **Recorded race:** a count taken while a reserved unit is being plated can be off by that unit; the next count corrects it. | A single number set by the manager would erase reservations made between reading the screen and saving, and the same units would be sold twice. | F §4.7 `EngineState.stock: Record<ItemId, number>` and "pre-cooked stock > 0" |
| S15 | **01a creates `@pos/engine` with the stock slice only** (`state.ts`, `apply-event.ts`, `stock.ts`, `version.ts`), replaces the identity reducer at `lib/boot.ts:279` with `applyEvent`, and registers a **boot step 3** handler that folds the `stock` stream (`StockSet` only) from `initialEngineState()` and puts the result in `ctx.initialState`; `createDeps` builds the state holder from it (the additive `BootContext` change in §2, v0.6). **Config load (v0.6):** the in-memory `branchConfig()` and its hash are loaded from `branch_config` + `config_snapshots` in a **boot step 5** handler, which runs after step 4 (`projections.catchUp`, `lib/boot.ts:153`), so a projection that was stale at boot (a USB restore plus the cloud tail, F §5.10) is caught up first. The server does not listen until after step 6, so no request and no station validation sees a config older than the projection. 03a replaces the step-3 fold with full replay and snapshots, and extends `applyEvent`. | Without a fold the manager's stock screen is empty until 03a, and a restart loses every count. A step-3 handler today cannot reach the state holder, which is created later (§2). | — (00 drift: `setReducer`, §2; additive `BootContext.initialState`, §2) |
| S16 | **`QueryCtx` gains `state` (read-only engine state) and `branchConfig` (the in-memory branch config; named so it is not confused with `CommandCtx.config`, the hub config file, S40 N9).** | The stock query must read the one stock authority (D50) without a table. | 00 §4.2 `defineQuery` ctx (additive) |
| S17 | **Item availability is a hub event pair.** `SetItemAvailability { item_id, is_available }` appends `ItemMadeUnavailable` or `ItemMadeAvailable` (one fact each, F §6.6), or nothing if the item is already in that state. Projection `item_availability`; a missing row means available. | D26 makes availability hub-owned and offline. | — |
| S18 | **Stock and availability are hub admin commands** (`sessionKind: 'admin'`) under a new permission **`manage-stock`**, granted by default to Owner and Manager (`default-roles.ts`). In 01b, custom roles can give it to a head cook. They also need `access-hub-admin` to open the page. | Stock must work with the internet down (hub-owned, D50) and from one tablet. | — |
| S19 | **Owner pages are cloud-served, owner accounts only.** Menu, tax classes, stations, programs, floors and tables are edited on cloud pages (`/owner/*`) by `owner_users` (00 JWT). Managers do not log in to the cloud in P1. Stock and availability live on the hub page `/admin/stock`. | The cloud owns the menu (F §3.1) and editing it needs no offline mode; the hub owns stock and availability, and the stock count must work offline. | — |
| S20 | **Removed in v0.5.** v0.3 chose static `.html` + ES-module `.js` pages with no bundler (`apps/{hub,cloud}/src/pages/`); v0.4 superseded it for 01a's pages; the owner confirmed S35, so no 01a page and no later client page uses that pattern, and no `src/pages/` folder is created. The number is kept so older references resolve. 00's hand-written pages (`/setup`, `/pair`, `/admin/bootstrap`, `/admin/approve`) are 00's own decision (M81, M82) and are not changed by 01a. | **Why removed:** the menu editor is form-heavy (items with per-branch routes, tax picker, money and minute fields, archive/restore), which is what a component framework is for; and 02 needs the same React client and the same components (PIN pad, staff tiles) for its login, ordering, cashier and KDS screens. Pages built on S35 now are reused by 02; pages built on S20 would be thrown away when 02 starts. | — (v0.3's F §6.9 addition of `src/pages/` is withdrawn) |
| S21 | **Cloud owner pages are served without tenant scope.** `GET /owner/*` on the cloud is static (the Vite build, S35), embeds no data and sets `tenantScope: 'none'`; the prefix joins the allowlist. v0.4: the cloud no longer serves `/ui/*`, because the build bundles the UI kit CSS and fonts (S35 d). Data comes only from `/v1/admin/*` under the JWT. Pages are sent with `Content-Security-Policy: default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` (v0.6: `base-uri` and `form-action` are not covered by `default-src`). The hub sends the **same header** on `/admin/stock/*`, whose admin session token is in `sessionStorage` as on 00's pages (`auth/admin-bootstrap.ts:132`). | The JWT lives in `sessionStorage` on an internet-facing page; a script injected through an item name would steal it. The hub admin token is worth the same protection on the LAN. | F §3.4 item 1 (allowlist) |
| S22 | **Archive, never delete.** Floors, tables, stations, programs, tax classes, categories and items are archived (`archived_at`) and can be restored. Archiving something still in use is refused with `409 CONFIG_IN_USE` (a floor with active tables, a station or program with active routes, a category or tax class with active items). An archived item disappears from new orders; open orders keep their copied lines (§4.4). Archived **stations** stay in the snapshot with `is_archived: true`, so KDS tickets already routed to them still render; `registerStationValidator` refuses them for new pairings. **v0.6:** archived **tax classes** and archived **programs** also stay in the snapshot with `is_archived: true`, so an open order's copied `tax_class_id` can still be resolved at bill close (S31) and a copied `program_id` can still be named on a ticket. New orders and routes never pick an archived row (§3.3). | Hard deletes would break history (E0 AC7) and the D25 copies' references. Without the v0.6 rule, an item moved from class X to Y with X then archived would leave an open bill whose `tax_class_id` 05 cannot resolve. | — |
| S23 | **Last write wins on PATCH.** Two owner sessions editing the same row overwrite field by field; no ETag. | One owner, a handful of edits a day; optimistic locking fails the YAGNI test. | — |
| S24 | **Removed in v0.6.** v0.5 had `POST /admin/config/pull-now` ("Get changes now"). Cut for the pilot: the 60 s poll is enough, and the stock page keeps one status line from config status (§6.21, §8.2). Removing it also removes the hub `503` that F §6.2 does not allow (review 1 S-8). The number is kept so older references resolve. | — | — |
| S25 | **00 drift (§2) is fixed by a 00 v1.2.1 editorial patch, with no behaviour change.** Exact edits to `00_Hub_Platform_Access_Spec_v1.2.md` (file renamed `…_v1.2.1.md`): **line 481** (§4.2 exports table): export name `registerReducer` → `state.setReducer(reducer)`; shape → "reducer `(state, event) => state`; one reducer, a later call replaces it; folded by the writer inside the transaction, and by replay (03a)"; used by → "01a, 03a". **Line 472** (`defineQuery` row): after "`ctx.db` is a read-only connection" add "; ctx = `{ db, page, directory, device, session }`". **Line 8** (version): "v1.2.1 — editorial (2026-10-25): §4.2 names match the code (01a S25); no behaviour change", and the README row. Behaviour checked: same signature; one reducer in both; the writer folds it (`writer.ts:79`); no replay in either yet. | The spec must match the code before 01a builds on it (CLAUDE.md: code and spec disagree → decide). | — (00 is not frozen; editorial patch) |
| S26 | **Cloud config audit trail.** Every owner config write (§6.3–6.16) inserts one `config_audit` row **in the same transaction** as the write, after it and before `bumpConfigVersion`: `actor_kind 'owner'` with `actor_owner_user_id` (JWT `sub`), or `actor_kind 'cli'` with no user for `set-branch-settings` (§6.7; `restore-bump` changes no config data and writes no row, S42), `entity`, `entity_id`, `branch_id` (null for tenant-level data), `action` ∈ `create`, `update`, `archive`, `restore`, `route_set`, `route_removed`, and `before` / `after` (the row in its wire shape, without `tenant_id`; `before` is null on create, `after` is null on route removal). A PATCH that sets and archives in one request writes one row with action `archive` (or `restore`). Insert-only: triggers block UPDATE and DELETE (F §3.1 audit rule). An idempotent replay writes nothing (the stored response is returned). No read endpoint in 01a (§12.4). | T2 requires an audit trail for admin actions; a price change or an archived item must say who did it and when, and the hub's `BranchConfigApplied` says only which version was live. | — |
| S27 | **`canonicalJson` and `sha256hex` move to `@pos/domain/hash`** (`packages/domain/src/hash.ts`, a **subpath export**, not re-exported from the package root: it imports `node:crypto`, and 02's browser clients import `@pos/domain`). The hub's `lib/hash.ts` re-exports them and keeps `payloadHash`, so its importers do not change. `packages/domain` gets `@types/node` 22.19.1 as a **devDependency** so `hash.ts` typechecks (types only; no runtime dependency; S40 N1). The cloud's `/v1/sync/config` uses the same functions for `snapshot_hash`. The cloud Zod-parses the built snapshot with `BranchConfigSnapshotSchema` **before** hashing: `pg` returns `BIGINT` as a string, and a `"120000"` string would hash differently from the hub's parsed number. **The hash covers the exact wire JSON (v0.6):** (i) the cloud hashes `wire = JSON.parse(JSON.stringify(parsed))` and sends that same `wire` object, so a key whose value is `undefined` is dropped from both; (ii) `canonicalJson` **throws** on `undefined` anywhere in its input instead of writing `null` (today `apps/hub/src/lib/hash.ts:9` writes `null`, while `JSON.stringify` drops the key); task 3 runs the existing hub hash and command tests to prove no current caller (`payloadHash`, `commands/route.ts:145`) passes one; (iii) the `/v1/sync/config` response schema types `snapshot` as `z.record(z.string(), z.unknown())`, so the Fastify serializer never reshapes it. | Two hand-copied serialisers would drift, and every poll would be rejected as a hash mismatch (§3.4 step 4). An optional field left `undefined` on one row would hash as `"x":null` on the cloud and be absent on the wire, so every hub would reject every snapshot: the freeze S28 exists to prevent. | — |
| S28 | **One snapshot schema version; the hash is checked over the raw JSON.** (a) The snapshot carries `snapshot_schema_version` (1 in 01a). `@pos/events/src/config.ts` exports `SNAPSHOT_SCHEMA_VERSION = 1` and `BranchConfigSnapshotSchemaV1`. (b) **Removed in v0.6:** there is no negotiation. The hub sends no schema parameter, the cloud has one builder, and there is no `SNAPSHOT_SCHEMA_MIN_SERVED`, no `409 SNAPSHOT_SCHEMA_UNSUPPORTED` and no `upgrade_required` outcome. **A breaking change** (a new schema version) **is released to the cloud and to every hub together**, outside service hours (3 known hubs, §7.8). A hub that receives a `snapshot_schema_version` other than its own rejects the config part (`schema_unsupported`), appends nothing, keeps its last config and shows the danger banner until it is upgraded (S29). After such a release, a stored body whose `snapshot_schema_version` differs from the hub's `SNAPSHOT_SCHEMA_VERSION` is treated like a missing body (`config_version` 0, §3.4 step 2); the cloud, upgraded in the same release, serves the hub's version, so the hub applies it once and the next poll is a `304`. (c) **Within one schema version the cloud may only add optional fields.** Removing or renaming a field, changing its meaning, or adding one the hub must act on needs a new version. The hub's schemas are not `.strict()`, so Zod drops fields the hub does not know. (d) **Hash first, then parse.** The hub `JSON.parse`s the response text, takes `data.config.snapshot` as raw JSON, checks `sha256hex(canonicalJson(raw)) === snapshot_hash`, and only then Zod-parses it with `BranchConfigSnapshotSchemaV1`. `config_snapshots.body` stores `canonicalJson(raw)`, unknown fields included, so the stored body always hashes to its key. Boot and replay parse the stored body the same way. (e) **Removed in v0.6** (v0.5 re-fetched on every poll while the cloud served an older schema; review 1 B1). | A cloud deploy that adds one field would otherwise change the hash the hub recomputes after Zod drops the field. Every hub would reject every snapshot and freeze on its last menu, with no error visible in the restaurant. | — |
| S29 | **Poll problems are visible, not only logged.** v0.6: (a) and (b), the `config_epoch` and its `rotate-config-epoch` CLI, are **removed**; version regression after a cloud restore is handled by `restore-bump` (S42), and `epoch_changed_at` and its banner are gone. What stays is (c): the poller keeps `last_problem { outcome: 'rejected' \| 'unauthorized', reason, at }` in memory until the next `applied` or `unchanged` poll. `reason` for `rejected` ∈ `malformed`, `hash_mismatch`, `schema_unsupported`, `schema_invalid`, `apply_failed` (S43). Config status (§6.21) returns it, and the stock page (§8.2) shows it as a danger banner. | A hub that refuses every snapshot (bad hash, wrong schema, a failing apply) would otherwise freeze on its last menu with nothing visible in the restaurant. | — |
| S30 | **Availability carries over between days, and the page says so.** A manual `Off` stays off until someone turns it on; nothing resets it at the start of a day [ASSUMPTION, owner question 4]. The stock query returns `unavailable_since` (the projection's `changed_at` when `is_available = 0`), and the page shows **"Off since \<day\>"** when that is before the current business day (S33). | An item switched off at closing would silently stay off at the next lunch service. The label lets the manager notice it during the morning stock count. | — |
| S31 | **Tax rate is resolved at bill close, not copied at order time.** An order line copies `tax_class_id` (D25 "tax class"), not `rate_bp`. 05 resolves the rate from `branchConfig()` at bill close; the rate may depend on the payment method [ASSUMPTION, owner question 7]. Consequence: a rate change between order and bill applies to that open bill. 01a's snapshot keeps `tax_classes[].rate_bp` as the current rate; 05 may extend the tax class shape through a new snapshot schema version (S28). | Copying `rate_bp` at order time would bake in a rate that the payment method may change at bill close (cash vs card, owner question 7). | F §3.3 / D25 "subsequent menu changes apply only to future orders" — narrowed: a tax **rate** change applies to bills closed after it |
| S32 | **[ASSUMPTION, owner question 3] `out_of_stock_behaviour` per item:** `cook_fresh` (default: when available stock is 0 the full cook time applies, D7 / E1 stock AC5) or `sold_out` (when available stock is 0 the item cannot be ordered until the next `StockSet` > 0; e.g. paye cannot be cooked in minutes, karahi can). Stored on `menu_items` and carried in the snapshot. Used only where the item is stock-tracked at that branch (§4.3); ignored elsewhere, with no validation error, because stock tracking is per-branch. 01a stores and delivers it; 02 and 03a act on it (§4.4). If the owner says every item is `cook_fresh`, the column stays with its default. | Without it, a sold-out paye would be offered with a full cook time no kitchen can meet. | D7 / E1 stock AC5 ("switches to full cook time when stock reaches 0") — narrowed for `sold_out` items, pending the owner's answer |
| S33 | **[ASSUMPTION, owner question 11] Business day start per branch.** `branches.business_day_start_ms` (local time of day in ms, 0 … 86 340 000, a multiple of 60 000, default 18 000 000 = 05:00). Carried in the snapshot. **v0.6: 01a cannot change it** (the `--business-day-start` CLI option is cut): every branch uses the 05:00 column default until 01b's branch settings endpoint, which waits on owner question 11. The **current business day** starts at the most recent local wall-clock time equal to it that is ≤ now (the runtime's OS time zone, as v0.2's "midnight" used; Pakistan has no DST). **v0.6:** `businessDayStartedAt(nowMs, businessDayStartMs)` lives in `@pos/domain` (`packages/domain/src/business-day.ts`, root export, browser-safe, no `node:*`), so the hub and 02's clients compute the same boundary. "Not counted today" (§8.2), "Off since" (S30) and `availableStock`'s day rule (S41) use it, not midnight. Carried to 05 for the Z report day (§4.4). | A restaurant open until 02:00 would see every count from 23:00 flagged "Not counted today" after midnight, and a Z report split at midnight would cut one service in two. | — |
| S34 | **Tax is optional, per item and per branch.** (a) `menu_items.tax_class_id` is **nullable**: null means the item is never taxed. (b) `branches.tax_enabled BOOLEAN NOT NULL DEFAULT false`, carried in the snapshot. When it is false, 05 applies no tax at that branch whatever the items say. (c) Tax applies to a line only when the branch has `tax_enabled` **and** the line has a `tax_class_id`. Payment-method rules (a different rate, or no tax, for cash vs card) are 05's, specified after OQ15 (§4.4). (d) In 01a, `tax_enabled` is set only through the cloud CLI `set-branch-settings` (§6.7; `seed-tenant` leaves the default). The owner endpoint is 01b's branch settings. [ASSUMPTION, owner question 7] | Many Pakistani restaurants charge no tax, some charge it only on card, and one branch may be registered while another is not. A required tax class would force a fake 0 % class on every item and could not express "this branch charges no tax". | **E0 menu AC8 "All items carry a tax class" — overridden**: the tax class is optional, and the branch flag can switch tax off |
| S35 | **Owner pages and `/admin/stock` are React entries in one Vite app, `apps/client`** (confirmed by the owner 2026-10-25, with the limits below). (a) **One app, one entry per surface.** `apps/client` (F §6.9) has one `package.json` and one `vite.config.ts`; each surface is an entry: `<entry>/index.html` → `src/features/…`. 01a has two: `owner` (`owner/index.html` → `src/features/owner/`, base `/owner/`, served by the cloud) and `admin-stock` (`admin-stock/index.html` → `src/features/admin/stock/`, base `/admin/stock/`, served by the hub). 02's ordering, cashier and KDS surfaces are added later as entries in the same way. **Each entry is its own Vite build** (`vite build --mode <entry>`, output `dist/<entry>/`), so the cloud never serves hub admin code and the hub never serves owner code (test 113). (b) Views inside an entry use hash routes (`/owner/#/menu`), handled by a small switch in `src/app/`. There is no router dependency, and the server needs no fallback route: it serves only the files in the build. (c) The cloud serves `apps/client/dist/owner/` under `/owner/*`; the hub serves `apps/client/dist/admin-stock/` under `/admin/stock/*` (§7.1). The build step and how each release ships the built files are S39 and §7.8. (d) **Styling is `packages/ui-kit` only.** `src/app/ui-kit.ts` imports `packages/ui-kit/tokens.css` and `packages/ui-kit/components/bundle.css` by relative path (the kit has no `package.json`, 00 M81); Vite bundles them and the fonts their `url()`s name. `apps/client` has no other stylesheet, no CSS framework, no CSS-in-JS and no `style` prop (ESLint, test 79). A style the kit lacks is added to `packages/ui-kit`, where 00's pages and 02 get it too, never to the app. `build.assetsInlineLimit: 0`, so every asset is a file under `assets/` and no `data:` URL meets the CSP of S21. (e) **XSS:** React escapes text. `dangerouslySetInnerHTML` is banned in `apps/client` (ESLint `no-restricted-syntax`, no plugin). The production build has no inline `<script>`, so the CSP of S21 stays as it is (test 15). (f) **Imports:** `apps/client` may import `@pos/domain` (root), `@pos/events`, `@pos/engine` (pure, workspace, no `node:*`; v0.6, so 02's clients use the same `availableStock` as the hub, S41), and CSS only from `packages/ui-kit`. It may not import `@pos/domain/hash` (it pulls in `node:crypto`, S27), `node:*`, anything under `apps/hub` / `apps/cloud`, or any other `.css` file (ESLint `no-restricted-imports`, test 79). (g) **Dependencies: a closed list, `apps/client` only** (versions checked 2026-10-25 on npm, pinned exactly in `apps/client/package.json`): runtime `react` 19.3.1, `react-dom` 19.3.1; dev `vite` 8.3.5 (Vitest 4.1.12 accepts `^8`), `jsdom` 30.1.3 (Vitest environment for component tests), `@types/react` 19.3.0, `@types/react-dom` 19.3.0. Nothing else: **no router, state, form or CSS library**, no React plugin, no testing library (tests render with `react-dom/client` and `act` from `react`). Adding any dependency to `apps/client` is a spec change. `jsdom` 30.1.3 needs Node ≥ 22.22.2, so dev machines and CI run Node 22.22.2 or later; the hub and cloud never run client code under Node. (h) **Hub `/admin/stock`: same choice; no concrete reason against was found.** Checked: bundle size (about 60 KB gzipped for React plus the page, over the LAN); it works with the internet down (hub-served, no CDN); R15 (no service worker, no secure-context API is needed); the admin login reuses 00's §8.2 endpoints with the shared `PinPad` and `StaffTiles` (i); deployment (built files ship with the hub release, S39). Cost accepted: 01a creates `apps/client` and its build, ahead of 02. (i) **Shared components for 02.** Components used by more than one entry, or built now for 02, live in `src/components/`. 01a builds `PinPad` and `StaffTiles` (the admin roster) for the `/admin/stock` login, plus `BusyButton` and `Banner` (§8.1 rules). They take data and callbacks as props and make no API calls, so 02's staff login and ordering screens reuse them unchanged with their own API client. (j) **Browser ULID (v0.6).** `Idempotency-Key` (§8.1) and `command_id` (§8.2, and every 02 command) are ULIDs made in the browser by one hand-written helper, `src/app/ulid.ts`: 48-bit `Date.now()` time plus 80 random bits from `crypto.getRandomValues`, Crockford base32, the same method as 00's `apps/hub/src/auth/pair-page.ts:207`. Not the `ulid` package (not on the closed list), and not `crypto.randomUUID`, which needs a secure context and the hub is plain HTTP on the LAN (R15). (k) **Browser-safe packages (v0.6.1).** `apps/client` imports `@pos/engine` and the root of `@pos/domain` (f), so neither may import a `node:*` module: no file under `packages/engine/**`, and no file under `packages/domain/src/**` except `src/hash.ts` (the `@pos/domain/hash` subpath, S27), imports `node:*`. Test files (`**/*.test.ts`) are exempt, as they never reach a browser. Enforced by an ESLint `no-restricted-imports` block for those paths (`{ group: ['node:*'] }`, repeating the root patterns, because a flat-config block replaces the rule's options), checked by test 127. A triple-slash `/// <reference types="node" />` is not an import and stays allowed in `hash.ts`. | One UI stack with 02, whose ordering, cashier and KDS clients are React in `apps/client` (stack table). The menu editor is the largest form in P1, and 02 needs the same PIN pad and staff tiles, so what 01a builds is kept, not rewritten (S20 removed). The limits keep the client to the stack table's React with nothing to learn or upgrade beside it, and one look (the UI kit) on 00's pages and the React pages. | F §6.9 `apps/client/src/` list: adds `components/` (additive). The entry `index.html` files and `vite.config.ts` sit at the package root, as in any Vite app |
| S36 | **Removed in v0.6.** v0.4–v0.5 resent the staff directory on an epoch change and applied it even when not newer, through a new `allowNotNewer` option on 00's `applyStaffDirectory` (a 00 v1.3 behaviour change). `restore-bump` (S42) raises `tenants.directory_version` instead, so M51 stays as it is and spec 00 needs no behaviour change. The number is kept so older references resolve. | — | — |
| S37 | **`GET /v1/admin/branches` is 01b's (closes Q3).** 01b specifies it with the branch settings endpoint (§12.5). Until 01b ships, the owner app's branch picker shows the branch IDs from the JWT's `allowed_branch_ids`. | The owner pages work without branch names; 01b needs the list for staff-to-branch assignment anyway. | — |
| S38 | **Q1 stays open until owner question 8 is answered** (who counts the stock in the morning). Until then, `manage-stock` plus `access-hub-admin` (S18) is the rule. | Choosing a staff-session stock screen before knowing whether a head cook counts would build a screen nobody may use. | — |
| S39 | **Client build and release are part of 01a.** (a) **Build:** `pnpm --filter @pos/client build` runs `vite build --mode <entry>` for every entry (01a: `owner`, `admin-stock`), each into `apps/client/dist/<entry>/` (emptied first), with a Vite manifest at `dist/<entry>/.vite/manifest.json`. `dist/` is git-ignored; built files are never committed. The root `pnpm test` runs the build before Vitest, so a broken build fails the suite, and tests 15 and 113 read real output. (b) **Serving:** the hub and the cloud find the output relative to their own source, `new URL('../../../client/dist/<entry>/', import.meta.url)` in `apps/{hub,cloud}/src/lib/client-dist.ts`, the same rule as 00 M81 for the UI kit. It holds in a dev checkout, in the hub's `/opt/pos-hub` checkout and in the cloud's deploy directory. File list and bodies are read into memory at registration (§7.1), so replacing the files on disk changes nothing until the process restarts. (c) **Cloud release:** the deploy builds at the release commit (`pnpm install --frozen-lockfile`, `pnpm --filter @pos/client build`) before the new version starts; the build machine may hold dev dependencies. The release is done only when `GET /owner/` answers `200` with the CSP header (§7.8). (d) **Hub release (v0.6: on site, outside service hours):** the hub machine has no dev dependencies and no Vite. A hub release is done **on site, from a developer machine on the restaurant LAN, outside service hours**, in this order: **stop** the hub → move the `/opt/pos-hub` **checkout** to the release tag (the tag is pushed to the hub over `ssh` on the LAN, so the hub needs no git credentials) → `pnpm install --frozen-lockfile --prod` (the hub needs internet for the npm registry) → **ship** `apps/client/dist/admin-stock/`, **built on the developer machine from the same commit**, with `apps/hub/deploy/ship-client.sh` (00 M36 folder; `bash`, `git`, `tar`, `ssh` only) → **start** the hub. The hub is stopped while code and page change, so no restart (a power cut, `Restart=always`) can boot new code with the old page. Remote hub updates stay out of scope (README milestone C). Only the `admin-stock` entry is copied; owner code never reaches a hub. (e) **Same commit or nothing:** `ship-client.sh` refuses to copy when the local tree is dirty, the build output is missing, the hub service is still active, or the hub checkout's `git rev-parse HEAD` differs from the local one, so the stock page always matches the hub's routes. It writes to a staging folder and swaps it in with `mv`, so a broken copy never replaces a good one. A hub without the folder still boots and takes orders; the stock page answers `404` and boot logs an error (§7.1), which the release check in §7.8 catches. | Without a defined build and copy step (plan review #18), a hub would run with no stock page, or with a page built from another commit that calls routes the hub does not have, and nothing in the release would notice. Building on the developer machine keeps Vite and dev dependencies off restaurant hardware (S35, F §1 deployment row). No spec defines remote access to a hub on mobile data, and a release during service would stop order taking (F §6.8 schedules upgrades outside service hours). | — (adds `ship-client.sh` to 00 M36's `apps/hub/deploy/`) |
| S40 | **Plan-review decisions (2026-10-25), from the implementation plan's "Needs spec change" list.** N1 `packages/domain` gets `@types/node` 22.19.1 as a dev dependency, for `hash.ts` only (S27, §12.1). N2 `onBranchConfigApplied(prev, next, tx)` passes the applying transaction, so 03a/03b append their reaction events in it (§4.2). N3 `bumpConfigVersion` reads, locks and updates `branches` through `TenantLevelRepository`: an allowed D54 exception, because S8's tenant-wide bump must reach every branch, not only the JWT's (§5.2). N4 a poll skipped because the hub is not provisioned or not confirmed has its own outcome `not_ready`, makes no HTTP call, and config status shows "Waiting for hub confirmation" (§3.4 step 1, §6.21, §8.2). N5 (removed in v0.6 with `pull-now`, S24). N6 S25's version edit is line 8. N7 money input drops every comma before parsing (§8.1, test 74). N8 `SetPrecookedStock`'s result `set_at` may differ by milliseconds from the stored `recorded_at`; the stock query is the source of truth (§6.17). N9 `QueryCtx.config` is named `QueryCtx.branchConfig` (S16). N10 §7.5 targets are checked by the runbook and the hub smoke script, not by automated tests. N11 (v0.6: test 102's page part covers the danger banner only) tests 75, 102, 103 and 104 each have a server (or render) part and a page part. **Both parts are automated:** the numbered test covers the first part, and a component or lint test cited `[01a §10 #n page part]` covers the page part, so each number is still cited by exactly one test. The page parts are **also** runbook steps in §11 step 29. The label **Runbook only** marks a check that has no automated test; none of these four has one. N12 the first boot after migration 0004 replays the full log once (§7.6). | The implementation plan found these gaps against the code (`docs/reviews/01a_plan_review.md`); each is decided here so the plan does not diverge from the spec. | §4.2 `onBranchConfigApplied` signature (N2); D54 for `bumpConfigVersion` only (N3) |
| S41 | **[ASSUMPTION, owner question 4] A stock count is valid for one business day.** `availableStock(state, itemId, businessDayStartMs)` in `@pos/engine` returns **0 when the entry's `set_at` is null or before `businessDayStartMs`** (the Unix ms start of the current business day, from `businessDayStartedAt`, S33), and `max(0, on_hand − reserved)` otherwise. The engine stays pure: the caller passes the start. This function is the **only** place the rule lives: the hub's SubmitOrder (02/03a), the stock query (§6.19), the catch-up `stock` part (§4.5) and 02's clients (S35 f) all call it. If the owner answers that leftovers are sold the next morning, only this function changes (it ignores `set_at`). There is no day-close `StockSet` (v0.5's requirement on 05 is withdrawn). | Without it, yesterday's closing count (e.g. 4 karahis thrown away at closing) would show as "4 left" at the next lunch and get stock-time ETAs for food that does not exist (E1 stock AC1 "at the start of service", AC6 "no count → 0"). | — |
| S42 | **Cloud CLI `restore-bump` after any cloud restore (replaces S29 a/b and S36).** `pnpm --filter cloud restore-bump --tenant <tenant_id>` (`apps/cloud/src/cli/restore-bump.ts`, `SystemContext`, M56) runs in one transaction: `UPDATE branches SET config_version = GREATEST(config_version + 1, $now_ms) WHERE tenant_id = $1` and `UPDATE tenants SET directory_version = GREATEST(directory_version + 1, $now_ms) WHERE tenant_id = $1`, with `$now_ms` the cloud's Unix ms. It prints each old and new version. It changes no config data, so it writes no `config_audit` row (S26). **Why it works:** every version only grows by 1 per write, so no pre-restore value can be near the current Unix ms (≈ 1.76 × 10¹²); a later restore gets a later `$now_ms`, so the rule holds again. Values stay below 2⁵³ (`z.number().int()` on the hub; `BIGINT` on the cloud; `INTEGER` in SQLite). The forward-only rules (§3.4 step 4, 00 M51) and spec 00 stay unchanged. **Must run after any cloud database restore or reseed, before hubs poll again** (requirement on 06 and the ops runbook, §4.4). **Consequence, for the restore runbook:** the restored directory is the backup's, so staff removed or PIN-reset after the backup come back on every hub (with the old PIN) until the owner removes or resets them again; the runbook lists those changes from 01b's audit trail and re-applies them right after `restore-bump`. | A cloud restore from yesterday's backup moves `config_version` back (e.g. 50 → 40) and `directory_version` back (35 → 30); every hub would ignore every snapshot and directory as "not newer", silently serving a menu and staff list the cloud no longer has. One CLI and no version comparison change does what the epoch, the directory resend and the 00 v1.3 change did. | — |
| S43 | **A failed apply is visible, and each part is retried alone (review 1 B2).** Step 5 of §3.4 runs the config part, the directory part and every `onBranchConfigApplied` hook in one `writer.run`. If that transaction throws (a hook, `applyStaffDirectory`, a projection, the disk), the poller: (a) records `last_problem { outcome: 'rejected', reason: 'apply_failed', at }`, logged at `error` with the error's message (never the body or the directory, §7.3); (b) retries **each part alone**, the directory part first, each in its own `writer.run`, so a staff removal (R14, M50, M38) never waits on a menu apply and a bad directory never blocks the menu. A part that fails again stays unapplied and is retried on the next poll; `last_problem` stays until a poll applies the config part or is `unchanged`. A hook that throws therefore never commits half a reaction. | A hook from 03a or 03b that throws for one config, or a directory row 00 cannot apply, would roll back both parts every 60 s with no outcome, no banner and no staff revokes. | §4.2 `onBranchConfigApplied` (failure semantics added) |

### 3.2 Branch config lifecycle (hub)

```
            boot step 5: branch_config row?            poll 200 with config, raw hash verified,
  ┌──────────┐  no row        ┌────────────────┐  schema = SNAPSHOT_SCHEMA_VERSION, and
  │  start   │──────────────► │ NONE (v = 0)   │  version > current (0 for NONE / BODY_MISSING)
  └──────────┘                └────────────────┘ ──────────────────────────────────┐
        │ row + body found, body schema = SNAPSHOT_SCHEMA_VERSION                  ▼
        └────────────────────────────────────────────────────────────────►┌──────────────┐
        │ row, body missing (cloud-only restore, USB restore + cloud tail)  │ APPLIED (vN) │◄─┐
        │ or body schema ≠ SNAPSHOT_SCHEMA_VERSION (after a breaking release)└──────────────┘  │
        ▼                                                                        │          │
  ┌────────────────────┐   next poll sends config_version=0                      │ poll 200 │
  │ BODY_MISSING (v=0) │──────────────────────────────────────────────────────── ┘  v > N  ─┘
  └────────────────────┘
  NONE / BODY_MISSING: stationExists() → false; /admin/queries/stock returns items: [].
  APPLIED stays APPLIED on rejected (incl. apply_failed, S43) / unauthorized / offline polls
  (last config kept, S29). After a cloud restore, restore-bump (S42) makes the cloud's version
  greater than N again, so the forward-only rule still applies it.
```

### 3.3 Validation rules (cloud)

| Rule | Error |
|---|---|
| Names 1–60 characters, trimmed; unique among **active** rows of the same scope (case-insensitive): floors and tables per branch (table names across the whole branch), stations per branch, programs per station, categories, tax classes and items per tenant | `400 VALIDATION_FAILED` / `409 CONFIG_NAME_TAKEN` |
| `price_minor` integer 0 … 10 000 000 00 (₨10 m); zero allowed | `400 VALIDATION_FAILED` |
| `cook_time_ms` 1 … 14 400 000 (4 h); `prep_buffer_ms` 0 … 3 600 000; `stock_time_ms` null or 0 … `cook_time_ms` (0 = served from stock with no station wait, E1 edge case) | `400` / `422 CONFIG_REFERENCE_INVALID` (stock > cook) |
| `rate_bp` integer 0 … 10 000 (basis points; 1 600 = 16 %) | `400` |
| Station: `capacity` 1 … 100; `freshness_window_ms` only for `batch` (0 … 3 600 000, default 0, D17); `completion_mode` ∈ `two_tap` (default), `single_tap`, `auto_done` | `400` |
| Route: station belongs to the branch and is active; slot station → `program_id` and `stock_program_id` null; batch station → `program_id` required, both programs active and on that station | `422 CONFIG_REFERENCE_INVALID` |
| Item references an active category, and an active tax class **when `tax_class_id` is not null** (null = never taxed, S34); table references an active floor of the same branch | `422 CONFIG_REFERENCE_INVALID` |
| `out_of_stock_behaviour` ∈ `cook_fresh` (default), `sold_out` (S32) | `400` |
| `business_day_start_ms` integer 0 … 86 340 000, multiple of 60 000 (S33; column CHECK in 01a, set by 01b's endpoint) | `400` |
| **PATCH rules run on the merged row (v0.6):** every rule above is checked on the stored row with the PATCH fields applied, inside the transaction after the row lock (e.g. lowering `cook_time_ms` below the stored `stock_time_ms` → `422 CONFIG_REFERENCE_INVALID` `stock_time_exceeds_cook_time`, never a SQL CHECK `500`) | as the rule |
| Path `branch_id` must be in the JWT's `allowed_branch_ids` | `404 BRANCH_NOT_FOUND` |
| Tenant-level write (tax classes, categories, items) needs every branch of the tenant in `allowed_branch_ids` (S8) | `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` |

**Item fields at a batch station (v0.6):** at a branch where the item's route is at a batch station, the item's own `cook_time_ms` and `stock_time_ms` are **not used**: the cook time is the program's, and stock tracking follows `stock_program_id` (F §4.7, D49; §4.3). They stay required or validated on the item because the same tenant-wide item may be routed to a slot station at another branch.

### 3.4 Config poll (hub, `apps/hub/src/sync/config-poller.ts`)

Runs every 60 000 ms from boot step 6. One poll runs at a time; a call during a poll waits for its result.
1. If the hub is not provisioned or not yet confirmed (00 M41): no HTTP call; record `{ outcome: 'not_ready', at }` and stop (S40 N4).
2. `current_config_version` = the `branch_config` row's version, or **0** if there is no row, `config_snapshots` has no body for its hash, or the row's `snapshot_schema_version` ≠ `SNAPSHOT_SCHEMA_VERSION` (S28 b). `current_directory_version` = `staff_directory_meta.directory_version`.
3. `GET /v1/sync/config?config_version=…&directory_version=…`, `Authorization: Bearer <branch_api_key>`, timeout 10 000 ms. Network error, timeout or 5xx → record `{ outcome: 'offline', at }`, stop. `401` → `last_problem { outcome: 'unauthorized' }`, log an error, stop. In each case the hub stays on its last config. `304` → record `unchanged`, clear `last_problem`, stop.
4. `200`: `JSON.parse` the text, then Zod-parse the envelope with `config.snapshot` typed as raw JSON (`z.record(z.string(), z.unknown())`). Malformed → `last_problem { outcome: 'rejected', reason: 'malformed' }`, stop (nothing written; the log never includes Zod issue inputs, §7.3). For `config`, in this order (S28 d): (i) `sha256hex(canonicalJson(raw))` ≠ `snapshot_hash` → reject the config part (`reason: 'hash_mismatch'`); (ii) `raw.snapshot_schema_version` ≠ `SNAPSHOT_SCHEMA_VERSION` → reject (`'schema_unsupported'`; only between a cloud and a hub not upgraded together, S28 b); (iii) Zod-parse with `BranchConfigSnapshotSchemaV1` (unknown fields dropped) → failure rejects (`'schema_invalid'`); (iv) **forward only** (the M51 pattern): `config_version ≤ current_config_version` → ignore the config part. A rejected config part still lets the directory part apply. The directory part applies only when newer (00 M51, inside `applyStaffDirectory`).
5. If nothing is left to apply, stop. Otherwise one `writer.run`: (a) config part: `INSERT OR IGNORE INTO config_snapshots (snapshot_hash, …, body = canonicalJson(raw))`, append `BranchConfigApplied` (`actor_id` null, `device_id 'hub'`); the projection writes `branch_config`; the `onBranchConfigApplied` hooks run. (b) directory part: `applyStaffDirectory(tx, directory, setDirectory)` (00's signature, unchanged). **If this transaction throws:** S43 (record `apply_failed`, then retry the directory part alone, then the config part alone, each in its own `writer.run`).
6. After each COMMIT, swap the in-memory config (D45); 00 swaps the directory itself. Record `{ outcome: 'applied', config_version, directory_version, at }`, and clear `last_problem` unless a config part was rejected or failed in this poll.

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| Foundation | Envelopes, Shared Standards, `PosEvent`, `stream_type 'stock'` and `'hub'` |
| 00 hub | `defineCommand`, `defineQuery`, `writer.run`, `registerProjection`, `registerBootStep('3' \| '5' \| '6')` (plus the additive `BootContext.initialState`, §2), `registerStationValidator`, `applyStaffDirectory` (unchanged signature), `state.setReducer`, `registerCatchUp`, `registerEventAudience`, `registerUiAssets` pattern, branch API key in hub config, `ids`, `clock` |
| 00 shared (moved by 01a, S27) | `canonicalJson`, `sha256hex` from `@pos/domain/hash` (hub and cloud) |
| 00 cloud | `tenant-scope` (JWT and `branch-key` scopes), `TenantScopedRepository`, `TenantLevelRepository`, `loadDirectory` (directory builder used by `/hubs/register`), error handler, migrations runner, `default-roles.ts`, owner login (`/v1/auth/*`) |

### 4.2 Exposes (later modules may rely only on these)

**Hub (`apps/hub/src`):**

| Export | Shape | Used by |
|---|---|---|
| `branchConfig()` | `() => BranchConfig \| null` (§4.3 snapshot, parsed; `null` before the first apply); swapped after commit | 02, 03a, 03b, 05 |
| `onBranchConfigApplied(fn)` | `fn(prev: BranchConfig \| null, next: BranchConfig, tx: WriterTx)` runs **inside** the applying `writer.run`, before COMMIT, so a module can append its own reaction events in the same transaction. **A hook that throws fails the whole apply** (nothing from it commits); the poller records `rejected` / `apply_failed` and retries each part alone (S43). A hook must therefore accept every config the cloud can validly send | 03a (station capacity/program changes), 03b |
| `itemAvailability(db, itemIds)` | `Map<item_id, boolean>`; one SQL statement | 02 |
| `businessDayStartedAt(nowMs, businessDayStartMs)` | **`@pos/domain`** root (`packages/domain/src/business-day.ts`, browser-safe, v0.6); Unix ms of the current business day's start in the runtime's local time zone (S33) | 02 (hub and clients), 03a, 05 (Z report) |
| `SNAPSHOT_SCHEMA_VERSION = 1`, `BranchConfigSnapshotSchemaV1` | `@pos/events/src/config.ts` (S28); within version 1 only optional fields may be added (S28 c); a new version is a release of the cloud and every hub together (S28 b) | 05, 06 |
| `QueryCtx.state`, `QueryCtx.branchConfig` | read-only engine state; `branchConfig()` | 02, 03a |
| `GET /queries/branch-config` | current snapshot for staff and station clients (§6.23) | 02, 03b clients |
| WS catch-up parts `branch_config`, `availability`, `stock` | §4.5 | 02, 03b clients |
| `@pos/engine`: `EngineState` (contains `stock` only, S14), `applyEvent` (folds `StockSet`), `availableStock(state, itemId, businessDayStartMs)` = 0 when `set_at` is null or before `businessDayStartMs` [ASSUMPTION, S41], else `max(0, on_hand − reserved)`, `stockOf(state, itemId)` = the entry or `{ on_hand: 0, reserved: 0, set_at: null }`, `ENGINE_STATE_VERSION = 1` | 03a extends; does not change the stock shape |
| Permission `manage-stock` | `@pos/domain/src/permissions.ts`; default Owner and Manager | 01b UI |
| `@pos/domain/hash`: `canonicalJson`, `sha256hex` (S27) | server-only subpath export | hub, cloud, 06 |

**Events introduced (all `schema_version: 1`):**

| Event | `stream_type` / `stream_id` | Payload | Pushed to (§4.5) |
|---|---|---|---|
| `BranchConfigApplied` | `hub` / branch_id | `{ config_version, snapshot_schema_version, snapshot_hash, previous_config_version \| null }` | staff and station sockets |
| `StockSet` | `stock` / item_id | `{ item_id, on_hand }` | staff sockets |
| `ItemMadeUnavailable` | `stock` / item_id | `{ item_id }` | staff sockets |
| `ItemMadeAvailable` | `stock` / item_id | `{ item_id }` | staff sockets |

**Cloud:** `GET /v1/sync/config` (§6.1), stable for 06; the `idempotency` helper `withIdempotency(ctx, request, fn)` (`apps/cloud/src/lib/idempotency.ts`), used by every later creating `POST` (01b, 05); `bumpConfigVersion(tx, scope)` (refuses a tenant-wide bump for an owner who does not cover every branch, S8); `writeConfigAudit(tx, entry)` (`apps/cloud/src/lib/config-audit.ts`, S26); the CLI `restore-bump` (S42), for 06's restore runbook.

### 4.3 Branch config snapshot (`@pos/events/src/config.ts`, `BranchConfigSnapshotSchemaV1`)

Arrays are sorted by `sort_order`, then id, so `canonicalJson` is stable (tax classes and programs, which have no `sort_order`, by name, then id). Only active rows, except stations, programs and tax classes, which keep archived rows with `is_archived: true` (S22). `BranchConfigSnapshotSchema` in earlier sections means `BranchConfigSnapshotSchemaV1` (S28).

```json
{
  "snapshot_schema_version": 1,
  "config_version": 42,
  "branch_id": "01JBF2A0000000000000BR0001",
  "currency_code": "PKR",
  "business_day_start_ms": 18000000,
  "tax_enabled": false,
  "floors": [
    { "floor_id": "01JC…F1", "name": "Ground", "sort_order": 1,
      "tables": [ { "table_id": "01JC…T1", "name": "T1", "seats": 4, "sort_order": 1 },
                  { "table_id": "01JC…T2", "name": "T2", "seats": null, "sort_order": 2 } ] }
  ],
  "stations": [
    { "station_id": "01JC…S1", "name": "Karahi", "location_label": null, "station_type": "slot",
      "capacity": 4, "freshness_window_ms": null, "completion_mode": "two_tap", "is_archived": false, "programs": [] },
    { "station_id": "01JC…S2", "name": "Fryer", "location_label": "Back kitchen", "station_type": "batch",
      "capacity": 8, "freshness_window_ms": 0, "completion_mode": "two_tap", "is_archived": false,
      "programs": [ { "program_id": "01JC…G1", "name": "Fry 180 °C", "cook_time_ms": 360000, "is_archived": false },
                    { "program_id": "01JC…G2", "name": "Reheat", "cook_time_ms": 120000, "is_archived": false } ] }
  ],
  "tax_classes": [ { "tax_class_id": "01JC…X1", "name": "Standard", "rate_bp": 1600, "is_archived": false } ],
  "categories": [ { "category_id": "01JC…C1", "name": "Karahi", "sort_order": 1 } ],
  "items": [
    { "item_id": "01JC…I1", "category_id": "01JC…C1", "name": "Chicken Karahi — Half",
      "group_label": "Chicken Karahi", "description": null, "sort_order": 1,
      "price_minor": 120000, "tax_class_id": "01JC…X1", "serve_mode": "sync",
      "prep_buffer_ms": 0, "cook_time_ms": 1200000, "stock_time_ms": 300000,
      "out_of_stock_behaviour": "cook_fresh",
      "station_id": "01JC…S1", "program_id": null, "stock_program_id": null }
  ]
}
```

`tax_class_id` may be `null` (never taxed, S34); `tax_enabled` is the branch flag (S34 b).

An item is **stock-tracked** at a branch when its route is at a slot station and `stock_time_ms` is not null, or at a batch station and `stock_program_id` is not null. At a batch station the item's `cook_time_ms` and `stock_time_ms` are not used: cook times come from `programs[].cook_time_ms` (§3.3, D49).

### 4.4 Requirements carried to other modules

| To | Requirement |
|---|---|
| 02 | **Mid-service safety:** an order line copies `item_id`, `name`, `price_minor`, `tax_class_id` (may be null, S34; **not** `rate_bp`, S31), `serve_mode`, `prep_buffer_ms`, `out_of_stock_behaviour` and the route (`station_id`, `cook_time_ms`, `stock_time_ms`, `program_id`, `stock_program_id`, and **v0.6:** at a batch station the programs' `program_cook_time_ms` and `stock_program_cook_time_ms`) from `branchConfig()` at order time (D25, plus the name). A config apply mid-service never changes an open order: a price change, a program cook-time change, or an archived item or program affects new orders only. The tax rate is the exception: 05 resolves it at bill close (S31). |
| 02 | **[ASSUMPTION, S32]** A stock-tracked `sold_out` item with `availableStock = 0` is shown greyed out like an unavailable item, with its own label ("Sold out"), and an order line for it is refused with an 02-defined code. A `cook_fresh` item at 0 stays orderable at the full cook time (D7). |
| 02 | The order line carries an optional free-text **kitchen note** (≤ 80 characters, no price effect), printed on the kitchen ticket and shown on the KDS (with 03b). It covers "less spicy / no onion" without a modifier model. |
| 02 | Read availability through `itemAvailability`; stock through `availableStock(state, itemId, businessDayStartedAt(now, config.business_day_start_ms))` (S41), on the hub and in clients; refetch config on the `BranchConfigApplied` push. Variants are separate items grouped by `group_label`. Tables are shown as tiles per floor in `sort_order`, with no positions. **Parking** is an order type with no table and an optional car description / spot text (F §5.9, E2 AC9; S10); 01a stores nothing for it [owner question 1 is 02's]. |
| 03a | Extend `@pos/engine` without changing the stock shape (S14): `StockReserved` / `StockReleased` change `reserved`; the hand-over step moves units out of `on_hand` and `reserved`; ETA uses `availableStock(…, businessDayStartMs) > 0` (S41). **Keep `on_hand ≥ 0` and `reserved ≥ 0` (S14).** **A count below the reserved units (v0.6):** a `StockSet` with `on_hand < reserved` triggers the D23 recalculation, which re-plans the `reserved − on_hand` most recently reserved units at the full cook time and releases them (`StockReleased`), so no open order keeps a stock-time ETA for a unit that does not exist. Hooks on `onBranchConfigApplied` must accept every valid config; a throw fails the apply (S43). **[ASSUMPTION, S32]** for a `sold_out` item, `availableStock = 0` means "cannot be reserved", never "fall back to the full cook time"; first-submit-wins (E1 stock AC4) then refuses the second order instead of re-quoting it. Replace 01a's boot step 3 with full replay. Through `onBranchConfigApplied`, define what a changed station `capacity`, `station_type`, program `cook_time_ms` or an archived station does to live reservations (D37 recalculation, or new orders only). |
| 03b | KDS tickets for an archived station still render (S22). Print the kitchen note. **E1 floors AC6 and edge case "warn admin about in-flight tickets" (deferred from 01a):** the cloud cannot see tickets, so the warning belongs on the hub. Through `onBranchConfigApplied`, when `next` archives a station that has open tickets, show a warning on that station's KDS and on the hub admin page; the tickets complete normally. |
| 02, 03b clients | **Client stack (S35, S39):** add each new surface (ordering, cashier kiosk, KDS) as an entry of `apps/client`, built and served like `admin-stock`; reuse `PinPad` and `StaffTiles` from `src/components/` for the staff login; style only with `packages/ui-kit`; the `apps/client` dependency list is closed (S35 g). Extend `ship-client.sh` to ship every hub-served entry, not only `admin-stock`. |
| 02, 03b clients | On connect, read `catch_up.state.branch_config` (§4.5); if its `snapshot_hash` differs from the cached one, fetch `GET /queries/branch-config` (§6.23). On a `BranchConfigApplied` frame, do the same. Apply `ItemMade*` and `StockSet` frames to the `availability` and `stock` parts (a `StockSet` frame sets `on_hand` and `set_at = recorded_at`). Compute `available` with `availableStock` from `@pos/engine` (S35 f, S41), and recompute it when the business day starts, because a stale count drops to 0 with no event. |
| 05 | **Tax at bill close (S31, S34):** tax applies to a line **only when** `branchConfig().tax_enabled` is true at bill close **and** the line's `tax_class_id` is not null. Otherwise the line carries zero tax. 05 then resolves the rate from `branchConfig()` at that moment, including a tax class archived since the order (it stays in the snapshot with `is_archived: true`, S22). **Payment-method rules** (a different rate or no tax for cash vs card, PRA receipts) are 05's to specify after OQ15 (R13) [ASSUMPTION, owner question 7]. Inclusive/exclusive pricing and rounding are 05's. Today's tax class = `{ tax_class_id, name, rate_bp }`; a per-payment-method rate goes in a new snapshot schema version (S28 c). |
| 05 | **Business day (S33):** the Z report and day close use `businessDayStartedAt` with `business_day_start_ms`, not midnight [ASSUMPTION, owner question 11]. **v0.6: day close writes no `StockSet`**; a count from an earlier business day already reads as 0 (S41). Whether manual `Off` toggles reset at the day start is owner question 4 (S30), and is not 05's. |
| 06 | Reuse `GET /v1/sync/config` and the poller; do not add a second config path. After any restore, run one config poll **before opening `/auth/*`**; a cloud-only restore leaves `config_snapshots` empty, so the poll fetches in full (S5). **After any cloud database restore or reseed, run `restore-bump --tenant <id>` before hubs poll again** (S42); without it, a restored lower `config_version` or `directory_version` is ignored by every hub. The runbook then re-applies the staff removals and PIN resets made after the backup (S42 consequence). |
| 01b | Every staff/role write bumps `tenants.directory_version` (00 M51), so the next 01a poll delivers it. Use `withIdempotency` on creating `POST`s. Own `GET /v1/admin/branches` and the branch settings endpoint (S37, §12.5). Audit staff removals and PIN resets so the restore runbook can re-apply them (S42). Build 01b's owner pages as views of the `apps/client` owner entry (S35). |

### 4.5 WS pushes and catch-up (F §6.5)

**No new `WsServerMessage` member.** 01a's pushes are frames of the existing `event` member of the union in `@pos/events/src/ws.ts`. That member already carries any `event_type` with its payload, and both ends validate it. The payload schemas are the four event schemas in `@pos/events` (§4.2). The catch-up adds parts to the existing `catch_up.state` record, through `registerCatchUp`. `WsClientMessage` is unchanged.

```json
{ "type": "event", "seq": 20811, "event": { "event_id": "01JC…", "event_type": "ItemMadeUnavailable", "schema_version": 1, "payload": { "item_id": "01JC…I1" } } }
{ "type": "event", "seq": 20812, "event": { "event_id": "01JC…", "event_type": "BranchConfigApplied", "schema_version": 1, "payload": { "config_version": 43, "snapshot_schema_version": 1, "snapshot_hash": "9f2c…", "previous_config_version": 42 } } }
```

**Audiences** (`registerEventAudience`, `apps/hub/src/ws/restaurant-audiences.ts`). Sockets are `staff` or `station` (00 `SocketCtx.kind`). Admin sessions have no socket: `/ws` accepts only staff and station sessions (00 `ws/server.ts:191`).

| Event | `staff` socket | `station` socket | Why |
|---|---|---|---|
| `BranchConfigApplied` | yes | yes | The KDS shows station names and `completion_mode`, which come from the config |
| `ItemMadeUnavailable`, `ItemMadeAvailable` | yes | no | Only ordering screens show availability (E0 availability AC1) |
| `StockSet` | yes | no | Only ordering screens show the countdown (E1 stock AC2); the KDS does not |

**Catch-up parts** (`registerCatchUp`, `apps/hub/src/ws/restaurant-catch-up.ts`). Each is built from memory or one statement. A part covers what a client missed while it was disconnected.

| Part | `appliesTo` | Shape | Built from |
|---|---|---|---|
| `branch_config` | staff, station | `{ config_version, snapshot_hash } \| null` (null before the first apply). The body is fetched with §6.23 only when the hash changed (~60 KB, not resent on every reconnect) | memory (`branchConfig()` and its hash) |
| `availability` | staff | `{ unavailable_item_ids: string[] }` (sorted) | 1 statement on `item_availability WHERE is_available = 0` |
| `stock` | staff | `{ business_day_started_at, items: { [item_id]: { on_hand, reserved, set_at, available } } }` for stock-tracked items in the config; `available` from `availableStock` (S41) | `EngineState.stock` (the `state` argument) and `businessDayStartedAt` |

**Latency (E0 availability AC1, "within 5 s"):** the push runs right after COMMIT (F §6.3 step order), with no timer or batching in between. Test 90 checks it under fake timers. A device that was offline for the change gets it in `availability` on reconnect.

---

## §5. Data model and migrations

### 5.1 Hub (SQLite) — `0004_restaurant_config.sql`

```sql
CREATE TABLE config_snapshots (                 -- S5: content-addressed, insert-only
  snapshot_hash  TEXT    PRIMARY KEY,           -- sha256 hex of canonicalJson(body)
  config_version INTEGER NOT NULL,
  body           TEXT    NOT NULL,              -- canonicalJson(raw snapshot), unknown fields kept (S28 d)
  received_at    INTEGER NOT NULL
);
CREATE TRIGGER config_snapshots_no_update BEFORE UPDATE ON config_snapshots
  BEGIN SELECT RAISE(ABORT, 'config snapshots are immutable'); END;
CREATE TRIGGER config_snapshots_no_delete BEFORE DELETE ON config_snapshots
  BEGIN SELECT RAISE(ABORT, 'config snapshots are immutable'); END;

CREATE TABLE branch_config (                    -- projection of BranchConfigApplied (rebuildable)
  branch_id      TEXT    PRIMARY KEY,
  config_version INTEGER NOT NULL,
  snapshot_schema_version INTEGER NOT NULL,     -- S28 b: ≠ SNAPSHOT_SCHEMA_VERSION → treated as body missing
  snapshot_hash  TEXT    NOT NULL,              -- body looked up in config_snapshots (may be absent, S5)
  applied_at     INTEGER NOT NULL               -- the event's recorded_at
);

CREATE TABLE item_availability (                -- projection of ItemMade{Una,A}vailable (rebuildable)
  item_id      TEXT    PRIMARY KEY,             -- itemAvailability(): WHERE item_id IN (…)
  is_available INTEGER NOT NULL CHECK (is_available IN (0,1)),
  changed_at   INTEGER NOT NULL,                -- the event's recorded_at
  changed_by   TEXT                             -- actor_id
);
```

No stock table (D50). Boot step 5 reads `branch_config` and its body: 2 primary-key lookups (S15). **Projection times come from the event (v0.6):** `branch_config.applied_at` and `item_availability.changed_at` are the event's `recorded_at`, never the clock, so a rebuild (reset + replay) gives byte-identical rows (test 47) and S30's "Off since" does not move after a replay.

### 5.2 Cloud (PostgreSQL 16) — `0002_restaurant_setup.sql`

Times `BIGINT` Unix ms; money `BIGINT` `_minor`. Tenant-level tables (M16 pattern, `TenantLevelRepository`): `tax_classes`, `categories`, `menu_items`, `idempotency_keys`, `config_audit`. **Allowed D54 exception (S40 N3):** `bumpConfigVersion` reads, locks and updates `branches` through `TenantLevelRepository` (`WHERE tenant_id = $1`), because S8's tenant-wide bump must reach every branch of the tenant, not only the JWT's `allowed_branch_ids`; the same locked read is where a tenant-wide write by an owner who does not cover every branch is refused (`403`, S8). No other code queries `branches` that way, apart from the `SystemContext` CLIs (`set-branch-settings`, `restore-bump`, M56). Branch-level (`TenantScopedRepository`): the rest. Every index leads with `tenant_id`.

```sql
ALTER TABLE branches ADD COLUMN config_version BIGINT NOT NULL DEFAULT 1;    -- S8 (expand-only); raised by restore-bump (S42)
ALTER TABLE branches ADD COLUMN business_day_start_ms INT NOT NULL DEFAULT 18000000
  CHECK (business_day_start_ms BETWEEN 0 AND 86340000
         AND business_day_start_ms % 60000 = 0);                             -- S33 [ASSUMPTION] 05:00
ALTER TABLE branches ADD COLUMN tax_enabled BOOLEAN NOT NULL DEFAULT false; -- S34

CREATE TABLE config_audit (                                                  -- S26: insert-only
  tenant_id TEXT NOT NULL, audit_id TEXT NOT NULL,                           -- audit_id: ULID
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('owner','cli')),           -- 'cli': set-branch-settings (§6.7)
  actor_owner_user_id TEXT,
  CHECK ((actor_kind = 'owner') = (actor_owner_user_id IS NOT NULL)),
  branch_id TEXT,                                                            -- null for tenant-level data
  entity TEXT NOT NULL CHECK (entity IN ('floor','table','station','batch_program',
                                         'tax_class','category','menu_item','item_route',
                                         'branch_settings')),
  entity_id TEXT NOT NULL,                                                   -- item_id for item_route
  action TEXT NOT NULL CHECK (action IN ('create','update','archive','restore','route_set','route_removed')),
  before JSONB, after JSONB,
  CHECK (before IS NOT NULL OR after IS NOT NULL),
  at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, audit_id),
  FOREIGN KEY (tenant_id, actor_owner_user_id) REFERENCES owner_users (tenant_id, user_id));
CREATE INDEX config_audit_entity ON config_audit (tenant_id, entity, entity_id, at);  -- "who changed this item's price"
CREATE FUNCTION config_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN RAISE EXCEPTION 'config_audit is insert-only'; END $$;
CREATE TRIGGER config_audit_no_update_delete BEFORE UPDATE OR DELETE ON config_audit
  FOR EACH ROW EXECUTE FUNCTION config_audit_immutable();

CREATE TABLE idempotency_keys (                                              -- S7, M69
  tenant_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  route TEXT NOT NULL, request_hash TEXT NOT NULL,
  response_status INT, response_body JSONB,                                  -- set before COMMIT
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, idempotency_key));
CREATE INDEX idempotency_keys_age ON idempotency_keys (tenant_id, created_at); -- 24 h prune per tenant, after COMMIT (S7)

CREATE TABLE floors (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, floor_id TEXT NOT NULL,
  name TEXT NOT NULL, sort_order INT NOT NULL DEFAULT 0, archived_at BIGINT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, floor_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);
CREATE UNIQUE INDEX floors_active_name ON floors (tenant_id, branch_id, lower(name))
  WHERE archived_at IS NULL;                                                 -- CONFIG_NAME_TAKEN

CREATE TABLE dining_tables (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, table_id TEXT NOT NULL,
  floor_id TEXT NOT NULL, name TEXT NOT NULL, seats INT CHECK (seats IS NULL OR seats BETWEEN 1 AND 100),
  sort_order INT NOT NULL DEFAULT 0, archived_at BIGINT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, table_id),
  FOREIGN KEY (tenant_id, branch_id, floor_id) REFERENCES floors);
CREATE UNIQUE INDEX dining_tables_active_name ON dining_tables (tenant_id, branch_id, lower(name))
  WHERE archived_at IS NULL;
CREATE INDEX dining_tables_floor ON dining_tables (tenant_id, branch_id, floor_id)
  WHERE archived_at IS NULL;                                                 -- floor archive check, list

CREATE TABLE stations (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, station_id TEXT NOT NULL,
  name TEXT NOT NULL, location_label TEXT,
  station_type TEXT NOT NULL CHECK (station_type IN ('slot','batch')),
  capacity INT NOT NULL CHECK (capacity BETWEEN 1 AND 100),
  freshness_window_ms INT CHECK (freshness_window_ms BETWEEN 0 AND 3600000),
  completion_mode TEXT NOT NULL DEFAULT 'two_tap' CHECK (completion_mode IN ('two_tap','single_tap','auto_done')),
  CHECK ((station_type = 'batch') = (freshness_window_ms IS NOT NULL)),
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, station_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);
CREATE UNIQUE INDEX stations_active_name ON stations (tenant_id, branch_id, lower(name))
  WHERE archived_at IS NULL;

CREATE TABLE batch_programs (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, station_id TEXT NOT NULL, program_id TEXT NOT NULL,
  name TEXT NOT NULL, cook_time_ms INT NOT NULL CHECK (cook_time_ms BETWEEN 1 AND 14400000),
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, program_id),
  FOREIGN KEY (tenant_id, branch_id, station_id) REFERENCES stations);
CREATE UNIQUE INDEX batch_programs_active_name ON batch_programs (tenant_id, branch_id, station_id, lower(name))
  WHERE archived_at IS NULL;                                                 -- also serves programs per station

CREATE TABLE tax_classes (
  tenant_id TEXT NOT NULL REFERENCES tenants, tax_class_id TEXT NOT NULL,
  name TEXT NOT NULL, rate_bp INT NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, tax_class_id));
CREATE UNIQUE INDEX tax_classes_active_name ON tax_classes (tenant_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE categories (
  tenant_id TEXT NOT NULL REFERENCES tenants, category_id TEXT NOT NULL,
  name TEXT NOT NULL, sort_order INT NOT NULL DEFAULT 0,
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, category_id));
CREATE UNIQUE INDEX categories_active_name ON categories (tenant_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE menu_items (
  tenant_id TEXT NOT NULL REFERENCES tenants, item_id TEXT NOT NULL,
  category_id TEXT NOT NULL, tax_class_id TEXT,                              -- S34: null = never taxed
  name TEXT NOT NULL, group_label TEXT, description TEXT CHECK (length(description) <= 300),
  sort_order INT NOT NULL DEFAULT 0,
  price_minor BIGINT NOT NULL CHECK (price_minor BETWEEN 0 AND 1000000000),
  serve_mode TEXT NOT NULL CHECK (serve_mode IN ('immediate','sync')),
  prep_buffer_ms INT NOT NULL DEFAULT 0 CHECK (prep_buffer_ms BETWEEN 0 AND 3600000),
  cook_time_ms INT NOT NULL CHECK (cook_time_ms BETWEEN 1 AND 14400000),
  stock_time_ms INT CHECK (stock_time_ms IS NULL OR stock_time_ms BETWEEN 0 AND cook_time_ms),
  out_of_stock_behaviour TEXT NOT NULL DEFAULT 'cook_fresh'
    CHECK (out_of_stock_behaviour IN ('cook_fresh','sold_out')),             -- S32 [ASSUMPTION]
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, item_id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES categories,
  FOREIGN KEY (tenant_id, tax_class_id) REFERENCES tax_classes);
CREATE UNIQUE INDEX menu_items_active_name ON menu_items (tenant_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX menu_items_category ON menu_items (tenant_id, category_id) WHERE archived_at IS NULL;   -- category archive check
CREATE INDEX menu_items_tax_class ON menu_items (tenant_id, tax_class_id) WHERE archived_at IS NULL; -- tax class archive check

CREATE TABLE item_routes (                                                   -- S11: one route per item per branch
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, item_id TEXT NOT NULL,
  station_id TEXT NOT NULL, program_id TEXT, stock_program_id TEXT,
  CHECK (stock_program_id IS NULL OR program_id IS NOT NULL),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, item_id),                               -- snapshot: routes of one branch
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items,
  FOREIGN KEY (tenant_id, branch_id, station_id) REFERENCES stations,
  FOREIGN KEY (tenant_id, branch_id, program_id) REFERENCES batch_programs,
  FOREIGN KEY (tenant_id, branch_id, stock_program_id) REFERENCES batch_programs);
CREATE INDEX item_routes_station ON item_routes (tenant_id, branch_id, station_id);  -- station archive check
CREATE INDEX item_routes_program ON item_routes (tenant_id, branch_id, program_id);  -- program archive check
CREATE INDEX item_routes_stock_program ON item_routes (tenant_id, branch_id, stock_program_id)
  WHERE stock_program_id IS NOT NULL;
```

The "slot station ⇒ no program" and "batch station ⇒ program" rules (§3.3) are checked in the service inside the transaction, after the station row is locked (`SELECT … FOR SHARE`), because SQL CHECK cannot read another table. The station's type cannot change while it has active routes (`409 CONFIG_IN_USE`, §6.9).

---

## §6. Endpoints, commands and events

All cloud routes are under `/v1`. Owner routes: JWT, tenant guard, and `branch_id` in `allowed_branch_ids` for branch paths. Every success is `{ data }`. Every creating `POST` runs through `withIdempotency` (S7). Every write runs in one transaction that ends with `bumpConfigVersion` (S8). Shared failure cases, not repeated per route: `400 VALIDATION_FAILED`, `401 JWT_INVALID`, `404 BRANCH_NOT_FOUND`, `422 IDEMPOTENCY_KEY_MISMATCH` (creating `POST`s), and `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` (tenant-level writes, §6.12–6.15, S8).

**Common write script (cloud):** validate (Zod) → `BEGIN` → [creating `POST`: insert idempotency key with `request_hash` over method, filled path and body (S7); on conflict wait, then replay or `422`] → load and lock the target row `FOR UPDATE` (`404` if absent) → rule checks on the merged row (§3.3; reference rows `FOR SHARE`, in id order) → write → `writeConfigAudit` (S26; `before` = the locked row, `after` = the written row) → `bumpConfigVersion` (branch rows last; tenant-wide: refuse an owner who does not cover every branch, S8) → [store the response on the key] → `COMMIT` → respond → [creating `POST`: prune old keys in their own statement, S7]. A unique-index violation on an active name maps to `409 CONFIG_NAME_TAKEN { entity, name }`. Any failure rolls back the write, the audit row and the key together.

#### 6.0 Permission and audit per route (§6.3–6.16)

Every route below needs an owner account: a JWT from `owner_users`, the tenant guard, and the path `branch_id` in `allowed_branch_ids` (S19). The cloud has no permission catalogue in P1; `edit-menu` is a hub permission and gates nothing here. No cloud route emits an event. The hub records the result as `BranchConfigApplied` on its next poll (S5).

| § | Route | Permission | `config_audit` row (entity / action) | Bumps |
|---|---|---|---|---|
| 6.3 | `POST …/branches/:b/floors` | owner | `floor` / `create` | branch |
| 6.4 | `PATCH …/floors/:id` | owner | `floor` / `update`, `archive` or `restore` | branch |
| 6.5 | `POST …/tables` | owner | `table` / `create` | branch |
| 6.6 | `PATCH …/tables/:id` | owner | `table` / `update`, `archive` or `restore` | branch |
| 6.9 | `POST …/stations` | owner | `station` / `create` | branch |
| 6.9 | `PATCH …/stations/:id` | owner | `station` / `update`, `archive` or `restore`; a slot change also writes one `batch_program` / `archive` row per program it archives | branch |
| 6.10 | `POST …/programs` | owner | `batch_program` / `create` | branch |
| 6.10 | `PATCH …/programs/:id` | owner | `batch_program` / `update`, `archive` or `restore` | branch |
| 6.12 | `POST` / `PATCH /v1/admin/tax-classes` | owner covering every branch (S8) | `tax_class` / `create`; `update`, `archive` or `restore` | every branch |
| 6.13 | `POST` / `PATCH /v1/admin/categories` | owner covering every branch (S8) | `category` / `create`; `update`, `archive` or `restore` | every branch |
| 6.14 | `POST /v1/admin/menu-items` | owner covering every branch (S8) | `menu_item` / `create`, plus one `item_route` / `route_set` per route | every branch |
| 6.15 | `PATCH /v1/admin/menu-items/:id` | owner covering every branch (S8) | `menu_item` / `update` (a price change: `before.price_minor`, `after.price_minor`), `archive` or `restore` | every branch |
| 6.16 | `PUT …/routes/:branch_id` | owner (+ `branch_id` allowed) | `item_route` / `route_set` or `route_removed` | that branch |

The reads (§6.2, 6.8, 6.11) write no audit row.

### Batch 1 — config delivery, floors and tables

#### 6.1 `GET /v1/sync/config` (branch API key, `tenantScope: 'branch-key'`)

| | |
|---|---|
| Query | `config_version` (int ≥ 0), `directory_version` (int ≥ 0) |
| Script | The tenant guard first resolves the branch key (1 statement, `plugins/tenant-scope.ts:51`, `branchByApiKeyHash`). Then, in one read-only `REPEATABLE READ` transaction (v0.6: statement (1) is inside it, so the version label always matches the content): (1) One statement: `SELECT b.config_version, b.business_day_start_ms, b.tax_enabled, t.directory_version, t.currency_code FROM branches b JOIN tenants t …` for the key's branch. (2) Both versions equal the query → **`304`, no body** (S4). (3) If `config_version` differs, build the snapshot in 6 fixed statements (floors + tables, stations + programs, tax classes, categories, items ⋈ routes for this branch). Parse it with `BranchConfigSnapshotSchemaV1` (numbers, not `BIGINT` strings, S27), take `wire = JSON.parse(JSON.stringify(parsed))`, set `snapshot_hash = sha256hex(canonicalJson(wire))` from `@pos/domain/hash`, and send `wire` (S27). (4) If `directory_version` differs, build the directory with 00's `loadDirectory` (5 statements). |
| Response | `200 { data: { config: { snapshot_hash, snapshot } \| null, directory: Directory \| null } }`; `snapshot.snapshot_schema_version = SNAPSHOT_SCHEMA_VERSION`. The response schema types `snapshot` as `z.record(z.string(), z.unknown())` (S27). The cloud answers `200` whenever a version differs in either direction; the hub decides what to apply (§3.4 step 4). |
| Errors | `401 BRANCH_API_KEY_INVALID`; `400 VALIDATION_FAILED` |
| Queries | after the guard's key lookup: 1 (304), ≤ 12 (200) |

#### 6.2 `GET /v1/admin/branches/:branch_id/floors`

Returns `{ floors: [{ floor_id, name, sort_order, archived_at, tables: [{ table_id, name, seats, sort_order, archived_at }] }] }`, including archived rows (the page filters). 2 statements. Bounded (one branch), so no pagination.

#### 6.3 `POST /v1/admin/branches/:branch_id/floors`

Body `{ name, sort_order? }`. `201 { data: { floor } }`. Errors: `409 CONFIG_NAME_TAKEN`. Bumps this branch.

#### 6.4 `PATCH /v1/admin/branches/:branch_id/floors/:floor_id`

Body: any of `{ name, sort_order, archived: boolean }`. Archiving with active tables → `409 CONFIG_IN_USE { entity: 'floor', id, used_by: { entity: 'table', ids } }`. Restoring checks name uniqueness. `200 { data: { floor } }`. `404 FLOOR_NOT_FOUND`.

#### 6.5 `POST /v1/admin/branches/:branch_id/tables`

Body `{ floor_id, name, seats?: int | null, sort_order? }`. Floor must be active and in this branch → else `422 CONFIG_REFERENCE_INVALID { field: 'floor_id' }`. `201`. `409 CONFIG_NAME_TAKEN`.

#### 6.6 `PATCH /v1/admin/branches/:branch_id/tables/:table_id`

Any of `{ floor_id, name, seats, sort_order, archived }`. `200`. `404 TABLE_NOT_FOUND`; `409 CONFIG_NAME_TAKEN`; `422 CONFIG_REFERENCE_INVALID`. Archiving a table that has an open order on the hub is allowed. The cloud cannot see open orders; 02 keeps the open order on its copied `table_id` [requirement on 02: an order on an archived table can still be billed and closed].

#### 6.7 Branch settings: CLI only in 01a (no endpoint)

`pnpm --filter cloud set-branch-settings --branch <branch_id> --tax-enabled true|false` (`apps/cloud/src/cli/set-branch-settings.ts`, `SystemContext`, M56). v0.6: the only setting is `tax_enabled`; `business_day_start_ms` keeps its 05:00 default in 01a (S33). In one transaction it locks the `branches` row `FOR UPDATE`, updates the row, writes a `config_audit` row (`branch_settings` / `update`, `actor_kind 'cli'`, `before` / `after`) and bumps this branch (S8). The owner endpoint (`PATCH /v1/admin/branches/:branch_id/settings`) and its page are **01b's**, with `GET /v1/admin/branches` (§12.5). Bulk table create is not built (§12.4).

#### 6.7a `restore-bump`: cloud CLI, no endpoint (S42)

`pnpm --filter cloud restore-bump --tenant <tenant_id>` (`apps/cloud/src/cli/restore-bump.ts`, `SystemContext`, M56). In one transaction: `UPDATE branches SET config_version = GREATEST(config_version + 1, $now_ms) WHERE tenant_id = $1 RETURNING branch_id, config_version`, then `UPDATE tenants SET directory_version = GREATEST(directory_version + 1, $now_ms) WHERE tenant_id = $1 RETURNING directory_version`; `$now_ms` from the injected clock. Prints each old and new value. No `config_audit` row (no config data changes, S26). Unknown tenant → exit code 1, nothing written. Run after every cloud restore or reseed, before hubs poll (§4.4 06).

### Batch 2 — stations and programs

#### 6.8 `GET /v1/admin/branches/:branch_id/stations`

`{ stations: [{ …station, archived_at, programs: [{ program_id, name, cook_time_ms, archived_at }] }] }`. 2 statements.

#### 6.9 `POST /v1/admin/branches/:branch_id/stations` and `PATCH …/stations/:station_id`

POST body `{ name, location_label?, station_type, capacity, freshness_window_ms? (batch only, default 0), completion_mode? }`; `201`. PATCH: any of those fields plus `archived`. Changing `station_type`, or archiving while active routes point at the station → `409 CONFIG_IN_USE { used_by: { entity: 'menu_item', ids } }` (served by `item_routes_station`). Station type change with no routes: the service sets or clears `freshness_window_ms` and archives the station's programs when it becomes `slot`. `404 STATION_NOT_FOUND`; `409 CONFIG_NAME_TAKEN`.

#### 6.10 `POST /v1/admin/branches/:branch_id/stations/:station_id/programs` and `PATCH …/programs/:program_id`

POST `{ name, cook_time_ms }`, station must be an active batch station → else `422 CONFIG_REFERENCE_INVALID { field: 'station_id' }`; `201`. PATCH any of `{ name, cook_time_ms, archived }`; archiving a program used by an active route (as `program_id` or `stock_program_id`) → `409 CONFIG_IN_USE`. `404 PROGRAM_NOT_FOUND`.

### Batch 3 — menu

#### 6.11 `GET /v1/admin/menu`

One read for the editor: `{ tax_classes, categories, items: [{ …item, archived_at, routes: [{ branch_id, station_id, program_id, stock_program_id }] }] }`, including archived rows. Routes only for the JWT's `allowed_branch_ids`. 4 statements. Bounded (< 1 000 items, [ASSUMPTION] owner question 6), so no pagination.

#### 6.12 `POST /v1/admin/tax-classes`, `PATCH /v1/admin/tax-classes/:tax_class_id`

`{ name, rate_bp }`; PATCH adds `archived`; archiving one used by an active item → `409 CONFIG_IN_USE`. Bumps every branch. `404 TAX_CLASS_NOT_FOUND`.

#### 6.13 `POST /v1/admin/categories`, `PATCH /v1/admin/categories/:category_id`

`{ name, sort_order? }`; PATCH adds `archived`; archiving one with active items → `409 CONFIG_IN_USE`. Bumps every branch. `404 CATEGORY_NOT_FOUND`.

#### 6.14 `POST /v1/admin/menu-items`

| | |
|---|---|
| Body | `{ category_id, tax_class_id: string \| null` (required key; `null` = never taxed, S34; the owner page sends `null` for "No tax"), `name, group_label?, description?, sort_order?, price_minor, serve_mode, prep_buffer_ms?, cook_time_ms, stock_time_ms?, out_of_stock_behaviour? (S32, default 'cook_fresh'), routes?: [{ branch_id, station_id, program_id?, stock_program_id? }] }`. `routes` has at most one entry per branch. |
| Script | common write script; reference checks lock the category, the tax class (when not null), each station and each program `FOR SHARE`; insert the item and its routes; bump **every** branch (S8). |
| Response | `201 { data: { item } }` with `routes` |
| Errors | `409 CONFIG_NAME_TAKEN`; `422 CONFIG_REFERENCE_INVALID { field, reason }` (archived or foreign category, tax class, station, program; program rules §3.3; `stock_time_ms > cook_time_ms`); `404 BRANCH_NOT_FOUND` for a route branch outside `allowed_branch_ids`; `403 PERMISSION_DENIED` for an owner who does not cover every branch (S8) |
| Queries | fixed: 1 key insert + 1 per reference kind (`= ANY($ids)`) + 2 inserts + 1 audit insert (item and route rows in one multi-row `INSERT`) + 2 bump (lock, update) |

#### 6.15 `PATCH /v1/admin/menu-items/:item_id`

Any item field plus `archived`. Item fields only; routes use §6.16. Rules run on the merged row (§3.3): lowering `cook_time_ms` below the stored `stock_time_ms` → `422 CONFIG_REFERENCE_INVALID` (`stock_time_exceeds_cook_time`). Archiving needs no in-use check: open orders hold copies (§4.4), and the item disappears from the next snapshot. Bumps every branch. `404 MENU_ITEM_NOT_FOUND`; `409 CONFIG_NAME_TAKEN`; `422 CONFIG_REFERENCE_INVALID`.

#### 6.16 `PUT /v1/admin/menu-items/:item_id/routes/:branch_id`

Idempotent replace of the one route: body `{ station_id, program_id?, stock_program_id? }` sets it; `{ station_id: null }` removes it (the item is no longer sold at that branch). A `PUT` needs no `Idempotency-Key`: repeating it gives the same state (§6.4 applies to creating `POST`s). `200 { data: { route \| null } }`. Bumps that branch. Errors as §6.14.

### Batch 4 — hub

Hub commands follow F §6.3 and 00 §3.7. Each is `sessionKind: 'admin'`, permission `manage-stock` (S18), and none is `approvable`.

#### 6.17 `POST /admin/commands/set-precooked-stock` — `SetPrecookedStock`

| | |
|---|---|
| Payload | `{ entries: [{ item_id, on_hand: int 0…9 999 }] }`, 1–200 entries, unique `item_id` (duplicate → `400 VALIDATION_FAILED`) |
| Script | idempotency fast path → `BEGIN IMMEDIATE` → re-check → auth re-check (M39) → `manage-stock` → config present (else `404 MENU_ITEM_NOT_FOUND` for the first entry) → each entry: item in `branchConfig()` (else `404 MENU_ITEM_NOT_FOUND { item_id }`), stock-tracked (§4.3, else `422 STOCK_NOT_TRACKED { item_id }`) → **one `StockSet` per entry, even when `on_hand` equals the current value** (v0.6: a re-count that confirms the same number still records the count and moves `set_at`, S41) → engine fold `applyEvent` for `nextState` → INSERT events + `processed_commands` → COMMIT → swap state (D45) → respond → push |
| Result | `{ items: [{ item_id, on_hand, reserved, available, set_at }] }`; `available` from `availableStock` with the current business day (S41). `set_at` here is the command's clock reading; the stored value is the event's `recorded_at`, read again when the event is appended, so the two may differ by milliseconds. The stock query (§6.19, test 72) is the source of truth (S40 N8). |
| Engine | touches `EngineState` → COMMIT-failure test required (F §6.7) |
| Note | 03a adds the D23 recalculation trigger to this command through `StockSet`, including the re-plan when `on_hand < reserved` (§4.4); 01a does not recalculate. |

#### 6.18 `POST /admin/commands/set-item-availability` — `SetItemAvailability`

Payload `{ item_id, is_available: boolean }`. Item in config (else `404 MENU_ITEM_NOT_FOUND`). If the current state (projection; a missing row means available) equals the request → no event, `result: { item_id, is_available, changed: false }`. Else one `ItemMadeUnavailable` / `ItemMadeAvailable`; the projection is updated in the transaction. `changed: true`.

#### 6.19 `GET /admin/queries/stock`

`sessionKind: 'admin'`, session required, permission `manage-stock`. Reads `ctx.branchConfig` and `ctx.state` (S16); `on_hand`, `reserved` and `set_at` come from `stockOf(state, item_id)` (S14), so there is no event scan. One statement on `item_availability` (`is_available`, `changed_at`) for the config's items. Returns `{ config_version, applied_at, business_day_started_at, items: [{ item_id, name, group_label, category_id, is_stock_tracked, out_of_stock_behaviour, on_hand, reserved, available, set_at | null, is_available, unavailable_since | null }] }`, in config order. `business_day_started_at` = `businessDayStartedAt(now, config.business_day_start_ms)` (S33); `available` = `availableStock(state, item_id, business_day_started_at)` (S41); `unavailable_since` = `changed_at` when the item is off (S30). **1 statement.** With no config: `items: []`, `business_day_started_at` from the default 05:00, 0 statements.

#### 6.20 Removed in v0.6

v0.5's `POST /admin/config/pull-now` is cut (S24). The number is kept so older references resolve.

#### 6.21 `GET /admin/queries/config-status`

`sessionKind: 'admin'`, session required, permission **`access-hub-admin`** (the same guard as the `/admin/stock` page; §12.2 agrees). `{ config_version, snapshot_schema_version, applied_at, directory_version, last_poll: { outcome, at } | null, last_problem: { outcome: 'rejected' | 'unauthorized', reason, at } | null }` from memory and 2 primary-key reads (S29). `outcome` ∈ `applied`, `unchanged`, `offline`, `rejected`, `unauthorized`, `not_ready` (S40 N4). `reason` for `rejected` ∈ `malformed`, `hash_mismatch`, `schema_unsupported`, `schema_invalid`, `apply_failed` (S29, S43). The page shows one status line, "Menu version 42 · checked 2 min ago" ("· offline" when the last poll was offline), or "Waiting for hub confirmation" for `not_ready`, plus the problem banner (§8.2).

#### 6.22 `registerStationValidator` (no route)

`(tx, stationId) => { const c = branchConfig(); return c !== null && c.stations.some(s => s.station_id === stationId && !s.is_archived) }`. It reads memory only; the single writer guarantees the config cannot swap mid-transaction. Registered at module load in `apps/hub/src/sync/station-validator.ts`, before the server listens.

#### 6.23 `GET /queries/branch-config`

`sessionKind: 'device'`, session required, `allowStation: true` (staff and KDS clients). No permission beyond a valid session: every client needs the menu, and the snapshot holds no secret. Returns `{ config_version, snapshot_hash, snapshot } | null` (null before the first apply) from memory: the in-memory holder keeps the parsed snapshot with its hash and version. 0 statements. Clients call it only when `catch_up.state.branch_config.snapshot_hash` or a `BranchConfigApplied` frame names a hash they do not hold (§4.5). This is the "clients refetch config" path that v0.1 named but did not define.

#### 6.24 Endpoint count

Cloud: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 6.9 ×2, 6.10 ×2, 6.11, 6.12 ×2, 6.13 ×2, 6.14, 6.15, 6.16 = **19** (v0.1 said 21 by mistake). Hub: 6.17, 6.18, 6.19, 6.21 and 6.23 = **5**. **Total 24**: inside the 10–25 target. History: v0.1 had 24 (it stated 26 by mistake); v0.2 added §6.23; v0.3's branch settings endpoint moved to 01b (§6.7); v0.6 removed §6.20 `pull-now` (S24). The CLIs `set-branch-settings` and `restore-bump` are not endpoints. Built page routes (`/owner/*` on the cloud, `/admin/stock/*` on the hub, S35) are not counted, as in 00 §6.33.

---

## §7. Cross-cutting

### 7.1 Built client pages (S35, S21)
`apps/{hub,cloud}/src/lib/client-dist.ts`: at registration it reads one build output once, file list and bodies, into memory (`apps/client/dist/owner/` on the cloud, `apps/client/dist/admin-stock/` on the hub, found relative to the helper's own source, S39 b) and serves only those files under the entry's prefix. A release that replaces the files on disk takes effect at the next restart. `index.html` is sent with `Cache-Control: no-cache`; files under `assets/` (Vite content-hashed names) with `Cache-Control: public, max-age=31536000, immutable`. The `Content-Type` comes from a fixed extension map (`.html`, `.js`, `.css`, `.woff2`, `.svg`, `.png`); a file whose extension is not in the map is not served (so `.vite/manifest.json` stays private). `/owner/` and `/admin/stock/` serve their `index.html`. Any other path, including `../` and unlisted names, → `404 ROUTE_NOT_FOUND`. A missing build output is logged at `error` at boot and its routes answer `404`; the server still starts, because the hub must keep taking orders without its stock page. Hub page: route group `admin-page` (host, provisioned and guest-network guards; no credentials, like M79). **Both apps** send the CSP header of S21 on every file they serve from the build (v0.6: the hub too). The helper exists in both apps and moves to a shared place only if the two copies drift (§12.4).

### 7.2 Poller timers
One `setInterval(60 000)` started at boot step 6 and cleared on shutdown, injectable for tests (§6.7 determinism: tests drive `pollOnce()` directly). Fixed interval: the cloud cost of a `304` is one indexed statement after the key lookup, so no backoff is needed. Bandwidth: 1 440 `304`s a day ≈ 1 MB/day per branch with headers.

### 7.3 Logging
The poller logs each outcome at `info` (unchanged at `debug`; `rejected`, including `apply_failed`, and `unauthorized` at `error`). Logs are not the only signal: the same problems are shown on the stock page (S29). It never logs the snapshot body or the directory (the directory holds PIN hashes, 00 §7.2 redaction). **v0.6:** for a `malformed` envelope it logs only the Zod issue paths and codes, never the issues' `input` or `received` values, because the envelope carries the directory. For `apply_failed` it logs the error's message and stack, never the body or the directory (S43).

### 7.4 Rate limits
None new. `/v1/sync/config` is called once a minute by three known hubs; owner routes sit behind owner login (00 M64).

### 7.5 Performance targets
`304` path ≤ 20 ms p95 on the cloud; snapshot build ≤ 200 ms p95 for 300 items. Hub apply ≤ 100 ms (it blocks the writer; at the 60 s cadence and a few changes a day this is negligible). `SetPrecookedStock` with 200 entries ≤ 50 ms p95 on the mini PC. These targets are checked by the manual runbook (§11 step 29) and the hub smoke script (`apps/hub/test/smoke/`), not by automated tests, because timings on shared CI and dev machines are not stable (S40 N10).

### 7.6 Risks
| Risk | Accepted because | Mitigation |
|---|---|---|
| While the branch is offline, a removed staff member keeps working on that hub until the next successful poll (S6) | Pilot; the owner can also force-logout on the hub (00 §6.15) | Config status shows "offline"; the poll runs within 60 s of the internet returning |
| A stock count taken during plating is off by one unit (S14) | The next count corrects it | — |
| Two owner sessions overwrite each other (S23) | One owner | — |
| `config_snapshots` grows forever (insert-only): ~5 changes/day × 60 KB ≈ 110 MB/year | Within the mini PC's disk for years | Pruning deferred (§12.4) |
| A new snapshot schema version deployed to the cloud without every hub (S28 b) | 3 known hubs, released together on site (§7.8) | The hub rejects it (`schema_unsupported`), keeps its last config and shows the danger banner; no data is lost |
| A cloud restore without `restore-bump` (S42) | The CLI step is in the restore runbook (06) | Hubs keep the newer pre-restore menu and directory until the cloud's versions pass theirs; the owner sees the edits missing on the cloud pages |
| After `restore-bump`, staff removed or PIN-reset after the backup come back (S42) | Cloud restores are rare; 01b audits staff changes | The restore runbook re-applies them from 01b's audit trail right after `restore-bump` |
| The first boot after migration 0004 replays the full event log once for the two new projections (`branch_config`, `item_availability`) | The pilot hub is new and its log is small; later boots resume from the projection checkpoints (S40 N12) | — |
| Business day uses the runtime's OS time zone (S33), on the hub and on clients (S41) | Single-country pilot, no DST | Installation checklist sets `Asia/Karachi` on the hub; tablets and phones are set to Pakistan time |

### 7.7 Folder placement (F §6.9 + S35)
Hub: the poller goes in `src/sync/` (listed in F §6.9). The snapshot apply goes in `src/projections/branch-config.ts`, the availability projection in `src/projections/item-availability.ts`, commands in `src/commands/`, queries in `src/queries/`, the station validator in `src/sync/station-validator.ts`, audiences and catch-up parts in `src/ws/restaurant-audiences.ts` and `src/ws/restaurant-catch-up.ts` (§4.5), the built-page helper in `src/lib/client-dist.ts` (§7.1). Cloud: `src/modules/restaurant/` (routes, service, repository, schemas), `src/modules/config-sync/` (one snapshot builder, `builder.ts`, S28), `src/lib/idempotency.ts`, `src/lib/config-audit.ts`, `src/cli/set-branch-settings.ts` (§6.7), `src/cli/restore-bump.ts` (S42, M56), `src/lib/client-dist.ts` (§7.1). Shared: `packages/domain/src/hash.ts` (subpath export `@pos/domain/hash`, S27), `packages/domain/src/business-day.ts` (root export, S33), `packages/events/src/config.ts`, `packages/events/src/events/stock/*.v1.ts`, `packages/events/src/events/hub/BranchConfigApplied.v1.ts`, `packages/engine/src/{state,apply-event,stock,version}.ts`. Client (S35, F §6.9): `apps/client/{owner,admin-stock}/index.html`, `apps/client/vite.config.ts` (one config, `--mode owner` / `--mode admin-stock`), `src/app/` (hash routes, entry bootstrap, `ulid.ts`, S35 j), `src/features/owner/{login,floors,stations,menu}/`, `src/features/owner/money.ts`, `src/features/admin/stock/`, `src/api/{cloud-admin,hub-admin}.ts` (typed fetch clients using `@pos/events` schemas), `src/components/` (`PinPad`, `StaffTiles`, `BusyButton`, `Banner`, S35 i), `src/app/ui-kit.ts` (the only stylesheet imports, S35 d), `src/i18n/`. Release: `apps/hub/deploy/ship-client.sh` (S39 d).

### 7.8 Build and release (S39)
**Build** (developer machine, CI, cloud deploy): `pnpm install --frozen-lockfile`, then `pnpm --filter @pos/client build` → `apps/client/dist/owner/` and `apps/client/dist/admin-stock/`. The root `pnpm test` runs the same build first.

**Cloud release:** at the release commit, build as above, run the new cloud version, then check `GET /owner/` → `200` with `Content-Type: text/html; charset=utf-8` and the CSP header (S21). A `404` means the build is missing: the release is not done. A release that changes the snapshot schema version (S28 b) is done together with every hub release, in the same visit window.

**Hub release** (v0.6: **on site, over the restaurant LAN, outside service hours**; stop → checkout → install → ship-client → start, S39 d). The hub serves nothing between steps 2 and 6, so no restart can pair new code with an old page:
1. On the developer machine, on the restaurant LAN, at the release tag with a clean tree: `pnpm install --frozen-lockfile && pnpm test` (this builds `apps/client/dist/`).
2. **Stop:** `ssh <ssh-target> sudo systemctl stop hub` (`apps/hub/deploy/hub.service`).
3. **Checkout:** `git push <ssh-target>:/opt/pos-hub refs/tags/<tag>` (over the LAN; the hub holds no git credentials), then `ssh <ssh-target> git -C /opt/pos-hub checkout <tag>`.
4. **Install:** `ssh <ssh-target> 'cd /opt/pos-hub && pnpm install --frozen-lockfile --prod'` (no Vite, no dev dependencies; the hub needs internet for the npm registry).
5. **Ship:** `apps/hub/deploy/ship-client.sh <ssh-target>`. It (a) refuses if `git status --porcelain` is not empty or `apps/client/dist/admin-stock/index.html` is missing; (b) refuses if `ssh <ssh-target> systemctl is-active hub` reports `active`; (c) refuses if `ssh <ssh-target> git -C /opt/pos-hub rev-parse HEAD` differs from the local `git rev-parse HEAD`; (d) streams `tar -C apps/client/dist -cf - admin-stock` over `ssh` into `/opt/pos-hub/apps/client/dist/admin-stock.new/`; (e) on the hub, moves `admin-stock` to `admin-stock.old` (if present) and `admin-stock.new` to `admin-stock`, then deletes `admin-stock.old`. Exit code 0 only when all steps succeeded. Only `admin-stock` is shipped.
6. **Start:** `ssh <ssh-target> sudo systemctl start hub`. Check `curl -s -o /dev/null -w '%{http_code}' http://<hub-ip>:<http_port>/admin/stock/` → `200` with the CSP header, and `journalctl -u hub -b` has no client-build error from §7.1.

The script is an ops tool that needs `ssh`, so it is checked by the runbook's release drill (§11 step 29), not by Vitest. A first install follows the same steps after the 00 installation. Remote hub updates (not on site) are out of scope (README milestone C).

---

## §8. Client contract

### 8.1 Cloud owner app (`apps/client`, entry `owner`, served at `/owner/`, S35)
| View (hash route) | Purpose |
|---|---|
| `#/login` | Email + password → `/v1/auth/login`; JWT and refresh token in `sessionStorage` (cleared when the tab closes) |
| `#/` | Branch picker from the JWT's `allowed_branch_ids`, showing branch IDs until 01b adds `GET /v1/admin/branches` (S37). Branch settings (`tax_enabled`, business day start) are not on 01a's pages; they are 01b's (§6.7) |
| `#/floors` | Floors with their tables; add, rename, reorder (sort number field, no drag), archive/restore |
| `#/stations` | Stations and programs; slot/batch; capacity; freshness window; completion mode |
| `#/menu` | Tax classes, categories, items; the item's tax class picker has a **"No tax"** option (`tax_class_id: null`, S34) and it is selected by default; per-branch route picker filtered by station type; prices typed in rupees and converted to paisa by one function in `src/features/owner/money.ts`: trim spaces, remove every comma, then the rest must be ASCII digits with at most 2 decimals (`"1,200"` → `120000`, `"1,20,000"` → `12000000`, `"1,2,3"` → `12300`, harmless); negatives, letters, other digits and more than 2 decimals are rejected (S40 N7); times typed in minutes, stored as `_ms`; **When pre-cooked stock runs out**: "Cook fresh" (default) / "Sold out" (`out_of_stock_behaviour`, S32) [ASSUMPTION]. An owner who does not cover every branch sees the menu read-only, with the `errors.PERMISSION_DENIED` text if a save is tried (S8) |

Rules: React function components; UI kit classes on plain elements (bundled, S35 d), `light` theme; no `style` prop and no stylesheet other than the kit (S35 d); shared pieces from `src/components/` (S35 i); strings from `src/i18n/` (keys `owner.*`, `errors.<CODE>`); one primary button per screen; busy button + 3 s slow banner; no `dangerouslySetInnerHTML` (S35 e). Each creating `POST` generates its `Idempotency-Key` with `src/app/ulid.ts` (S35 j) when the form opens and keeps it across retries of that form. On `401 JWT_INVALID` the app refreshes once (`/v1/auth/refresh`), then goes to login. No offline mode: on a network failure the page shows a banner and keeps the form.

### 8.2 Hub page `/admin/stock` (`apps/client`, entry `admin-stock`, served by the hub, S35)
- Opens on a paired tablet, kiosk or the owner's phone. If there is no admin session, it shows the admin roster and PIN pad (same endpoints as 00 §8.2), built from the shared `StaffTiles` and `PinPad` (S35 i), which 02's staff login reuses.
- **One status line** from `GET /admin/queries/config-status` (§6.21), read on open and every 15 s: "Menu version 42 · checked 1 min ago" ("· offline" after an offline poll), or "Waiting for hub confirmation" while `last_poll.outcome` is `not_ready`. v0.6: no "Get changes now" button (S24).
  - `last_problem` set → **danger banner** until it clears: `rejected` "Menu update refused (\<reason\>). The hub is still using version 42." (`apply_failed` reads "Menu update could not be applied"); `unauthorized` "The hub's cloud key was refused. Call support."
- One row per item in config order: name, then for stock-tracked items **On hand** (number input, `inputmode="numeric"`), **Reserved**, **Available** (from the query, so a count from an earlier business day shows 0, S41), and "Set at 11:05", with a warn badge "Not counted today" when `set_at` is null or before `business_day_started_at` (S33, not midnight). A `sold_out` item shows "Sold out when 0" next to the count (S32). Every item has an **Available / Off** toggle (§6.18); an item that is off with `unavailable_since` before `business_day_started_at` shows the warn badge **"Off since \<Mon 24 Oct\>"** (S30).
- **Save counts** sends one `SetPrecookedStock` with **every row the user touched**: edited (even back to the same number) or confirmed with the row's **Confirm** button, which re-sends the shown `on_hand` (v0.6, §6.17, S41). `command_id` from `src/app/ulid.ts` (S35 j), generated per save and kept for retries (D32).
- Refreshes after each of its own saves, and re-reads `GET /admin/queries/stock` and `GET /admin/queries/config-status` every 15 s while the page is visible. An admin session has no WS socket (§4.5), so the page cannot receive pushes. The query does not count as activity (M59), so the poll does not keep an idle admin session alive. A refresh never overwrites a row the user is editing. While the hub is unreachable it shows the reconnect banner and keeps the typed values (UI kit README).

### 8.3 i18n
All strings are keys (D12); English only until Urdu is added (00 M82).

---

## §9. Error catalogue additions

Appended to F §6.2 and `@pos/domain/src/errors.ts` in the same change (the only allowed foundation edit).

| Code | Status | `details` | Returned when |
|---|---|---|---|
| `BRANCH_NOT_FOUND` | 404 | `{ branch_id }` | Path or route `branch_id` not in the JWT's `allowed_branch_ids`, or unknown |
| `FLOOR_NOT_FOUND` | 404 | `{ floor_id }` | PATCH on an unknown floor |
| `TABLE_NOT_FOUND` | 404 | `{ table_id }` | PATCH on an unknown table (code named in F §6.2 examples; first defined here) |
| `PROGRAM_NOT_FOUND` | 404 | `{ program_id }` | PATCH on an unknown program |
| `TAX_CLASS_NOT_FOUND` | 404 | `{ tax_class_id }` | PATCH on an unknown tax class |
| `CATEGORY_NOT_FOUND` | 404 | `{ category_id }` | PATCH on an unknown category |
| `MENU_ITEM_NOT_FOUND` | 404 | `{ item_id }` | Unknown item on the cloud; hub stock/availability for an item not in the branch config |
| `CONFIG_NAME_TAKEN` | 409 | `{ entity, name }` | An active row in the same scope has the name (§3.3) |
| `CONFIG_IN_USE` | 409 | `{ entity, id, used_by: { entity, ids } }` | Archive or station type change while active rows depend on it (S22) |
| `CONFIG_REFERENCE_INVALID` | 422 | `{ field, reason: 'archived' \| 'not_found' \| 'wrong_branch' \| 'program_required' \| 'program_not_allowed' \| 'program_wrong_station' \| 'stock_time_exceeds_cook_time' }` | A reference breaks §3.3 |
| `IDEMPOTENCY_KEY_MISMATCH` | 422 | `{ idempotency_key }` | Same key, different request hash (S7) |
| `STOCK_NOT_TRACKED` | 422 | `{ item_id }` | `SetPrecookedStock` for an item that is not stock-tracked at this branch (§4.3) |

v0.6: `SNAPSHOT_SCHEMA_UNSUPPORTED` (v0.3–v0.5) is withdrawn with the schema negotiation (S28 b). It was never merged, so no catalogue entry is removed. A missing `Idempotency-Key` header is `400 VALIDATION_FAILED` with `issues[0].path = 'headers.idempotency-key'`. A tenant-level write by an owner who does not cover every branch reuses the foundation's `403 PERMISSION_DENIED` with `details { reason: 'tenant_wide_write' }` (S8); no new code.

---

## §10. Tests

Names cite `[01a §10 #n]`. Hub tests: temp SQLite + `inject()`; cloud tests: PostgreSQL 16 (F §6.7). Every cloud route is also covered by 00's route-inventory and cross-tenant tests (D54, M25).

### 10.1 Cloud — config delivery and idempotency

| # | Covers | Case |
|---|---|---|
| 1 | §6.1, S4 | Both versions equal → `304`, empty body, exactly 1 SQL statement after the tenant guard's key lookup (query counter, §6.1) |
| 2 | §6.1 | `config_version` behind → `200`, `config.snapshot` parses with `BranchConfigSnapshotSchema`, `snapshot_hash` = sha256 of canonical JSON, `directory: null` |
| 3 | §6.1, S6 | `directory_version` behind only → `config: null`, directory equals `loadDirectory` output |
| 4 | §6.1, S22 | Snapshot contains only active rows and only this branch's routes, except: an archived station, an archived program and an archived tax class are present with `is_archived: true` (v0.6); an archived item and an item with no route at this branch are absent |
| 5 | §6.1 | Snapshot query count is fixed (≤ 12) for 10 and 300 items |
| 6 | §6.1 | Unknown/revoked branch key → `401 BRANCH_API_KEY_INVALID` |
| 7 | S8 | Table rename at branch A bumps A only; item price change bumps A, B, C |
| 8 | S8 | 10 concurrent config writes on one branch → `config_version` increases by exactly 10 |
| 9 | S7 | Creating `POST` without `Idempotency-Key` → `400 VALIDATION_FAILED` (`headers.idempotency-key`) |
| 10 | S7 | Same key + same body twice → identical status and body, second has `Idempotent-Replay: true`, one row created |
| 11 | S7 | Same key + different body → `422 IDEMPOTENCY_KEY_MISMATCH` |
| 12 | S7 | Two concurrent requests, same key → one create; the other gets the replay |
| 13 | S7 | A failed create (`409`) stores no key; a corrected retry with the same key succeeds |
| 14 | S7 | Key rows older than 24 h for the tenant are deleted on the next insert; other tenants' rows untouched |
| 15 | S21, S35 | `GET /owner/` and a built `/owner/assets/*.js` need no JWT, carry the CSP header `default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, and are on the allowlist; the built `index.html` has no inline `<script>`; cloud `/ui/*` → `404`; route-inventory passes |

### 10.2 Cloud — restaurant data

| # | Covers | Case |
|---|---|---|
| 16 | §6.2–6.3 | Create floor; list returns it with nested tables in 2 statements |
| 17 | §3.3 | Duplicate active floor name (case-insensitive) → `409 CONFIG_NAME_TAKEN`; same name allowed after archiving the first |
| 18 | §6.4, S22 | Archive floor with an active table → `409 CONFIG_IN_USE` listing the table |
| 19 | §6.4 | Unknown floor → `404 FLOOR_NOT_FOUND` |
| 20 | §6.5 | Table with `seats: null` → created; appears in the snapshot with `seats: null` (v0.6: parking is no longer a floor, S10) |
| 21 | §6.5 | Table on an archived floor or another branch's floor → `422 CONFIG_REFERENCE_INVALID` |
| 22 | §6.6 | Unknown table → `404 TABLE_NOT_FOUND` |
| 23 | §3.3 | Path branch not in `allowed_branch_ids` → `404 BRANCH_NOT_FOUND` |
| 24 | §6.9 | Slot station without freshness; batch station defaults freshness 0; `freshness_window_ms` on a slot → `400` |
| 25 | §6.9, S22 | Archive a station with an active route → `409 CONFIG_IN_USE`; archive after the route is removed → OK |
| 26 | §6.9 | Change `station_type` while routes exist → `409 CONFIG_IN_USE`; with none, batch → slot archives its programs |
| 27 | §6.9 | Unknown station → `404 STATION_NOT_FOUND` |
| 28 | §6.10 | Program on a slot station → `422 CONFIG_REFERENCE_INVALID` (`program_not_allowed`) |
| 29 | §6.10 | Archive a program used as `stock_program_id` → `409 CONFIG_IN_USE` |
| 30 | §6.10 | Unknown program → `404 PROGRAM_NOT_FOUND` |
| 31 | §6.12 | Tax class `rate_bp` 10 001 → `400`; archive one in use → `409`; unknown → `404 TAX_CLASS_NOT_FOUND` |
| 32 | §6.13 | Archive a category with active items → `409`; unknown → `404 CATEGORY_NOT_FOUND` |
| 33 | §6.14 | Item with a slot route and `stock_time_ms` → created; `price_minor` stored as integer paisa; float price → `400` |
| 34 | §6.14, S11 | Batch route without `program_id` → `422` (`program_required`); program of another station → `422` (`program_wrong_station`); station of another branch → `422` (`wrong_branch`) |
| 35 | §3.3 | `stock_time_ms > cook_time_ms` → `422` (`stock_time_exceeds_cook_time`); `stock_time_ms = 0` → OK |
| 36 | §6.14 | Route for a branch outside `allowed_branch_ids` → `404 BRANCH_NOT_FOUND`; nothing written |
| 37 | §6.14 | Query count fixed for 1 and 3 routes |
| 38 | §6.15, S22 | Archive item → absent from the next snapshot; restore → back; unknown → `404 MENU_ITEM_NOT_FOUND` |
| 39 | §6.16 | PUT route twice → same state, one bump each; `{ station_id: null }` removes it; item absent from that branch's snapshot |
| 40 | §6.11 | Menu list: 4 statements; routes only for allowed branches |
| 41 | S12 | Two items sharing `group_label` "Chicken Karahi" with different prices and stock times → both in the snapshot |

### 10.3 Hub — config apply, replay, directory

| # | Covers | Case |
|---|---|---|
| 42 | §3.4, S5 | Poll `200` with config → one `BranchConfigApplied`, body in `config_snapshots`, `branch_config` row, `branchConfig()` swapped after COMMIT |
| 43 | §3.4 | Poll `304` → no event, no write, outcome `unchanged` |
| 44 | §3.4 | Snapshot hash mismatch → nothing written, `last_problem { rejected, hash_mismatch }`, old config kept |
| 45 | §3.4 | `config_version` ≤ current → config part ignored (forward only) |
| 46 | S5, D45 | Forced COMMIT failure during apply → `branchConfig()` unchanged, no snapshot row |
| 47 | S5, S15 | Restart: boot step 5 loads the config from `branch_config` + `config_snapshots`; projection rebuild (reset + replay) gives byte-identical `branch_config` and `item_availability` rows (`applied_at`, `changed_at` = the events' `recorded_at`, §5.1) |
| 48 | S5 | Cloud-only restore: events present, `config_snapshots` empty → hub sends `config_version=0`, applies the full snapshot; state `BODY_MISSING` → `APPLIED`. Same for a stored body whose `snapshot_schema_version` ≠ `SNAPSHOT_SCHEMA_VERSION` |
| 49 | S5 | UPDATE or DELETE on `config_snapshots` aborts (trigger) |
| 50 | S6, S43 | Poll with config and directory → both applied in **one** transaction. Forced failure in the config part → `last_problem { rejected, apply_failed }`, the directory applied alone in its own transaction, the config not applied; forced failure in the directory part → the config applied alone, the directory not applied |
| 51 | S6, R14, M38 | Directory that removes a staff member who owns a paired phone → `DeviceRevoked { cause: 'owner_removed' }` and `SessionEnded 'staff_removed'` in the poll transaction |
| 52 | S6, M75 | Directory with a malformed hash for an existing staff member → their row kept, no revoke (01a calls 00 unchanged) |
| 53 | §3.4 | Network error / cloud `401` → outcome `offline` / `last_problem.outcome = 'unauthorized'`, nothing written, next tick retries |
| 54 | §3.4 | Two concurrent `pollOnce()` → one HTTP request; both callers get its result |
| 55 | — | **Removed in v0.6** (`pull-now`, S24). Number not reused |
| 56 | §6.21 | Config status shows the last outcome and versions; no `config_epoch` or `epoch_changed_at` field |
| 57 | §6.22, M31 | Before any config, `ApprovePairingRequest` for KDS → `404 STATION_NOT_FOUND`; after apply → paired; archived station → `404 STATION_NOT_FOUND` |
| 58 | §4.2 | `onBranchConfigApplied` hook runs inside the transaction with prev/next; an event it appends commits with `BranchConfigApplied` |

### 10.4 Hub — stock and availability

| # | Covers | Case |
|---|---|---|
| 59 | §6.17 | Morning entry of 3 items → 3 `StockSet` events, result shows `on_hand`, `reserved 0`, `available` |
| 60 | §6.17, S41 | An entry whose `on_hand` equals the current value still appends one `StockSet` and moves `set_at` to its `recorded_at` (v0.6) |
| 61 | §6.17 | Item not in config → `404 MENU_ITEM_NOT_FOUND`; not stock-tracked → `422 STOCK_NOT_TRACKED`; nothing written for any entry |
| 62 | §6.17 | Duplicate `item_id` in entries → `400 VALIDATION_FAILED`; 201 entries → `400` |
| 63 | §6.17 | Without `manage-stock` → `403 PERMISSION_DENIED`; Manager default role has it |
| 64 | §6.17, D32 | Retransmit same `command_id` → identical response, `Idempotent-Replay: true`, no new events |
| 65 | §6.17, D45 | Forced COMMIT failure → `EngineState.stock` unchanged |
| 66 | S14 | Engine unit: state `{ on_hand 5, reserved 2, set_at T0 }` + `StockSet 4` recorded at T1 → `{ 4, 2, T1 }`, available 2; `StockSet 1` → available 0 (never negative); `{ on_hand 5, reserved 5 }` + `StockSet 3` → `{ 3, 5 }`, available 0, `on_hand` and `reserved` never below 0 |
| 67 | S15 | Restart → boot step 3 rebuilds stock from `StockSet` events; values equal pre-restart |
| 68 | S15, F §6.7 | `packages/engine/fixtures/engine-state.v1.json` equals `buildEngineState(fixture log)` |
| 69 | §6.18, S17 | Toggle off → `ItemMadeUnavailable`, projection row 0 with `changed_at` = the event's `recorded_at`; toggle off again → no event, `changed: false`; on → `ItemMadeAvailable` |
| 70 | §6.18 | Retransmit → replay; unknown item → `404`; no `manage-stock` → `403` |
| 71 | §4.2 | `itemAvailability(db, ids)` = 1 statement for 1 and 100 ids; missing row = available |
| 72 | §6.19, S41 | Stock query: 1 statement (query counter); `set_at` from `EngineState.stock`, equal to the latest `StockSet`'s `recorded_at`; `available` from `availableStock` with `business_day_started_at`; no config → `items: []`, 0 statements |
| 73 | §4.5 | `StockSet` and `ItemMade*` are pushed to staff sockets, not to station sockets; `BranchConfigApplied` is pushed to both |

### 10.5 Pages (S35)

Component tests run in the `apps/client` Vitest project (`environment: 'jsdom'`), rendering with `react-dom/client` and `act`.

| # | Covers | Case |
|---|---|---|
| 74 | §8.1, S40 N7 | `money.ts`: `"1,200"` → 120000, `" 1,200 "` → 120000, `"1,20,000"` → 12000000, `"1,2,3"` → 12300, `"1200.5"` → 120050, `"1.234"` / `"-1"` / `"abc"` / `"١٢٠٠"` → rejected |
| 75 | §8.1, S35 e | **Automated (numbered):** menu view: an item name containing `<img src=x onerror=…>` renders as text (no `img` element in the DOM). **Automated (page part, lint test):** any `dangerouslySetInnerHTML` in `apps/client` fails lint. **Also a runbook step (§11 step 29):** a scratch `dangerouslySetInnerHTML` makes `pnpm lint` fail |
| 76 | §8.1 | Form retry reuses its `Idempotency-Key`; a newly opened form gets a new one |
| 77 | §8.2 | Stock page saves every touched row (an edit back to the same number, or the row's Confirm) and no untouched row, reuses `command_id` on retry, shows "Not counted today" for a `set_at` before `business_day_started_at` (S33) |
| 78 | §7.1, S21 | `client-dist` helper (hub and cloud) serves only files in the build output, each with the S21 CSP header; `index.html` has `no-cache` and `assets/*` `immutable`; `../`, unlisted names and the other entry's files → `404 ROUTE_NOT_FOUND`; a missing build output → boot logs an error, the server starts, the routes `404` |
| 79 | S35 d, f | Lint: `apps/client` importing `@pos/domain/hash`, `node:*`, `apps/hub/**`, `apps/cloud/**` or a `.css` file outside `packages/ui-kit` fails (`no-restricted-imports`); a JSX `style` prop fails (`no-restricted-syntax`); importing `packages/ui-kit/tokens.css`, `@pos/engine` and `@pos/domain` passes |

### 10.5a Added in v0.2

| # | Covers | Case |
|---|---|---|
| 80 | S26, §6.0 | Create floor → one `config_audit` row: `floor` / `create`, `before` null, `after` = the response's floor, `actor_owner_user_id` = JWT `sub`, `branch_id` set |
| 81 | S26 | PATCH item `price_minor` 120000 → 130000 → one row `menu_item` / `update` with `before.price_minor = 120000` and `after.price_minor = 130000`, `branch_id` null |
| 82 | S26 | Archive then restore a category → `archive`, `restore` rows; route PUT → `item_route` / `route_set`; `{ station_id: null }` → `route_removed` with `after` null; batch → slot station change → one `batch_program` / `archive` row per program |
| 83 | S26, S7 | Idempotent replay of a create → still one audit row; a failed write (`409 CONFIG_NAME_TAKEN`) → no audit row; forced failure after the audit insert (in `bumpConfigVersion`) → no row, no write |
| 84 | S26 | `UPDATE` or `DELETE` on `config_audit` raises (trigger); cross-tenant test covers `config_audit` (D54) |
| 85 | S27 | Hash parity: a snapshot built by the cloud from PostgreSQL rows (`BIGINT` price, `INT` times) and hashed there equals the hub's `sha256hex(canonicalJson(BranchConfigSnapshotSchema.parse(body)))`; a snapshot left with `"120000"` as a string fails the cloud-side parse before hashing |
| 86 | S8, §5.2 | Race: `PUT …/routes/:b` to station S and `PATCH …/stations/S { archived: true }` run concurrently, both orders (barrier on the `FOR SHARE` / `FOR UPDATE` lock) → either the route commits and the archive gets `409 CONFIG_IN_USE`, or the archive commits and the route gets `422 CONFIG_REFERENCE_INVALID` (`archived`); never an active route on an archived station; no deadlock |
| 87 | S8, §5.2 | Race: `POST /v1/admin/menu-items` with a route using program G as `stock_program_id` and `PATCH …/programs/G { archived: true }` concurrently → the same two outcomes as #86; two concurrent tenant-wide writes (two item creates) both commit, with no deadlock (S8 lock order) |
| 88 | §3.3 | Zero-price item (`price_minor: 0`) → `201`; in the snapshot with `price_minor: 0` |
| 89 | S14, S41, E1 stock AC6 | A new stock-tracked item with no `StockSet` → stock query shows `on_hand 0, reserved 0, available 0, set_at null`; `availableStock` = 0; catch-up `stock` part has it at 0 |
| 90 | §4.5, E0 availability AC1 | Under `vi.useFakeTimers()`, a connected staff socket receives the `event` frame for `ItemMadeUnavailable` from `SetItemAvailability` with the clock advanced by less than 5 000 ms (the frame is sent after COMMIT with no timer in between); a socket that reconnects afterwards gets the item in `catch_up.state.availability.unavailable_item_ids` |
| 91 | §4.5 | Catch-up: a staff socket gets `branch_config`, `availability` and `stock` (with `business_day_started_at` and `set_at`); a station socket gets `branch_config` only; before any config, `branch_config` is null |
| 92 | §6.23 | `GET /queries/branch-config` from a staff and a station session → current snapshot, hash and version, 0 statements; before the first apply → `data: null`; no session → `401` from 00's session guard |
| 93 | S14, S15 | Restart after `StockSet` → `set_at` equals its value before the restart (the fold reads `recorded_at`, not the clock) |

### 10.5b Added in v0.3

| # | Covers | Case |
|---|---|---|
| 94 | S28 c, d | **Unknown field accepted:** a cloud snapshot (hashed by the cloud) with an extra `items[0].spice_level: 2` and a top-level `"promo": {}` → the hub applies it; the hash verifies over the raw JSON; `branchConfig()` has neither field; `config_snapshots.body` keeps both, and `sha256hex(body)` equals `snapshot_hash`; restart parses the stored body to the same `branchConfig()` |
| 95 | S28 d | **Hash before parse:** a snapshot whose raw hash does not match, but whose Zod-stripped form would match, is rejected (`hash_mismatch`), proving the hash is taken before Zod |
| 96 | — | **Removed in v0.6** (snapshot schema negotiation, S28 b/e). Number not reused |
| 97 | — | **Removed in v0.6** (snapshot schema negotiation, S28 b/e). Number not reused |
| 98 | — | **Removed in v0.6** (snapshot schema negotiation, S28 b/e). Number not reused |
| 99 | — | **Removed in v0.6** (config epoch, S29 a/b). Number not reused |
| 100 | — | **Removed in v0.6** (config epoch, S29 a/b). Number not reused |
| 101 | — | **Removed in v0.6** (config epoch, S29 a/b). Number not reused |
| 102 | S29, §6.21, §8.2 | **Automated (numbered):** after a hash-mismatch poll, config status returns `last_problem { rejected, hash_mismatch, at }`; it clears after the next `applied` or `unchanged`. **Automated (page part, component test) and also a runbook step:** the stock page shows the danger banner for `rejected` (including `apply_failed`) and `unauthorized`, and the one status line with "Waiting for hub confirmation" for `not_ready` |
| 103 | S30, §6.19 | **Automated (numbered):** item turned off yesterday at 22:00, business day started today at 05:00 → stock query `unavailable_since` = yesterday 22:00; turned off today at 06:00 → `unavailable_since` today 06:00; available item → `unavailable_since: null`. **Automated (page part, component test) and also a runbook step:** the page shows "Off since \<day\>" for the first case and no badge for the second |
| 104 | S33 | **Automated (numbered):** `businessDayStartedAt` (`@pos/domain`): start 05:00, now 02:00 → yesterday 05:00; now 05:00 exactly → today 05:00; start 00:00 → local midnight. **Automated (page part, component test) and also a runbook step:** "Not counted today": `set_at` yesterday 23:00 at now 02:00 → no badge; at now 06:00 → badge |
| 105 | §6.7, S34, S26 | CLI `set-branch-settings --tax-enabled true` → row updated, one audit row `branch_settings` / `update` with `actor_kind 'cli'`, `before` / `after`, this branch bumped only, the value in the next snapshot. `--business-day-start` → refused as an unknown option (v0.6), nothing written |
| 106 | S32, §6.14 | Item created without `out_of_stock_behaviour` → `cook_fresh`; PATCH to `sold_out` → in the snapshot and audited; `"never"` → `400`; `sold_out` on an item with no stock tracking at a branch → accepted (ignored there) |
| 107 | S34, §6.14, §3.3 | Item created with `tax_class_id: null` → `201`; it appears in the snapshot with `"tax_class_id": null`. A tax class archived while only null-tax items exist → allowed. `tax_class_id` of an archived class → `422 CONFIG_REFERENCE_INVALID`. PATCH from a class to null → audited, in the next snapshot |
| 108 | S34 | A new branch (`seed-tenant`) has `tax_enabled: false` in its snapshot; after `set-branch-settings --tax-enabled true` the next snapshot has `true`; the snapshot schema rejects a missing `tax_enabled` |
| 109 | — | **Removed in v0.6** (directory resend, S36). Number not reused |
| 110 | — | **Removed in v0.6** (directory resend, S36). Number not reused |
| 111 | — | **Removed in v0.6** (directory resend, S36). Number not reused |
| 112 | — | **Removed in v0.6** (directory resend, S36). Number not reused |

### 10.5c Added in v0.5

| # | Covers | Case |
|---|---|---|
| 113 | S35 a, d, S39 a | Build output (after `pnpm --filter @pos/client build`): `dist/owner/index.html` and `dist/admin-stock/index.html` exist; every `src`/`href` in each `index.html` names a file inside that entry's own folder; no `<script>` without `src`; no `data:` URL in any built `.css` or `.js`; the entry's `.vite/manifest.json` lists no module under the other entry's `src/features/` folder (owner: none under `src/features/admin/`; admin-stock: none under `src/features/owner/`) and no `.css` source outside `packages/ui-kit` |

### 10.5d Added in v0.6 (review 1)

| # | Covers | Case |
|---|---|---|
| 114 | S27 | **Wire hash:** a cloud snapshot where an optional field is `undefined` on one item and set on another → the cloud's `snapshot_hash` equals the hub's hash over the received JSON, and the hub applies it; `canonicalJson({ a: undefined })` and `canonicalJson([undefined])` throw; the existing hub hash and command idempotency tests still pass |
| 115 | S43, §4.2 | An `onBranchConfigApplied` hook that throws → no `BranchConfigApplied`, no event from the hook, `branchConfig()` unchanged, `last_problem { rejected, apply_failed }`, logged at `error` without the body or directory; a directory in the same response is applied alone; the next poll retries the config, and once the hook stops throwing the config applies and `last_problem` clears |
| 116 | S41 | `availableStock(state, item, dayStart)`: `set_at` before `dayStart` → 0 even with `on_hand 4`; `set_at` ≥ `dayStart` → `max(0, on_hand − reserved)`; `set_at` null → 0. Hub: yesterday's count of 4 at 23:00, now 12:00 the next day → stock query and catch-up `stock` part show `available 0` and `on_hand 4`; after a `SetPrecookedStock` of 4 → `available 4` |
| 117 | S8, §6.12–6.15 | Owner with `allowed_branch_ids = [A]` in a tenant with A, B, C: `POST /v1/admin/menu-items`, `PATCH` item price, `POST` tax class and `PATCH` category archive → `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`, nothing written, no audit row, no idempotency key stored, no branch bumped; the same owner's `POST …/branches/A/floors` → `201` |
| 118 | §6.6 | `PATCH …/tables/:id`: rename → `200`, audited, branch bumped; move to another active floor of the branch → `200`, appears under that floor in the next snapshot; archive → absent from the snapshot; restore with a name now taken → `409 CONFIG_NAME_TAKEN`; restore otherwise → back |
| 119 | §6.10 | `POST …/programs` on a batch station → `201`, in the snapshot under the station; `PATCH` `cook_time_ms` → `200`, audited `batch_program` / `update`, branch bumped |
| 120 | §6.12, §6.13 | `POST` tax class → `201`, every branch bumped, in every snapshot; `PATCH` `rate_bp` → `200`, audited with `before` / `after`; `POST` category → `201`, in every snapshot |
| 121 | §3.3, §6.15 | PATCH validation on the merged row: item with `stock_time_ms 300000`, `PATCH { cook_time_ms: 200000 }` → `422 CONFIG_REFERENCE_INVALID` (`stock_time_exceeds_cook_time`), not `500`; nothing written |
| 122 | S7 | Same `Idempotency-Key` and the same body on `POST …/branches/A/floors` then `POST …/branches/B/floors` → second is `422 IDEMPOTENCY_KEY_MISMATCH`; with old keys present, two concurrent creates both commit (no deadlock), old keys are pruned after COMMIT, and a forced prune failure still returns `201` |
| 123 | S42, §6.7a | Cloud at `config_version 50`, `directory_version 35`, hub applied both; restore an older dump (40, 30) → the next poll ignores both (forward only); `restore-bump --tenant <t>` → every branch's `config_version` and the tenant's `directory_version` ≥ the clock's `now_ms` and > the old values, no `config_audit` row; the next poll applies the restored config and directory in one transaction (M51 unchanged); a second `restore-bump` later in the test raises them again; unknown tenant → exit 1, nothing written; runs only through `SystemContext` (M56 lint test) |
| 124 | S15, §2 | Boot: a stock fold registered at step 3 reaches the state holder (`ctx.initialState`), so counts survive a restart; a `branch_config` projection whose checkpoint is behind the log (a `BranchConfigApplied` appended after it, as after a USB restore plus the cloud tail) → after boot, `branchConfig()` and the station validator use the newest config, because boot step 5 runs after step 4's catch-up |
| 125 | S35 j | `src/app/ulid.ts`: 26 Crockford base32 characters matching `ULID_RE` (`@pos/domain`), time part from `Date.now()`, random part from `crypto.getRandomValues`; 1 000 calls → 1 000 distinct values; works with `crypto.randomUUID` undefined (no secure context) |
| 126 | §7.3, §3.4 | A `200` whose envelope fails Zod (e.g. `directory.staff[0].pin_hash` a number, with a real hash in `staff[1]`) → `last_problem { rejected, malformed }`; the captured log lines contain the issue path but no `pin_hash` value and no `$argon2id$` string |

### 10.5e Added in v0.6.1

| # | Covers | Case |
|---|---|---|
| 127 | S35 k | Lint (ESLint `lintText`): `import { createHash } from 'node:crypto'` fails in `packages/engine/src/x.ts` and in `packages/domain/src/x.ts`; the same import passes in `packages/domain/src/hash.ts` and in `packages/domain/src/x.test.ts`; `import { ULID_RE } from '@pos/domain'` passes in `packages/engine/src/x.ts`; `pnpm lint` passes on the real tree |

### 10.6 Acceptance table

| Story AC | Test |
|---|---|
| E1 floors AC1 (floors; canvas narrowed S9) | 16, 17 |
| E1 floors AC2 (tables; shape/position narrowed S9) | 20, 21, 118 |
| E1 floors AC3 slot/batch, capacity, programs (floor position narrowed S10) | 24, 28, 119 |
| E1 floors AC4 freshness window default 0 | 24 |
| E1 floors AC5 rename, archive, history preserved | 17, 18, 25, 38, 118 |
| E1 floors AC6 archived station with in-progress tickets (snapshot keeps it) | 4, 57 (data part); the warning is **deferred to 03b** (§4.4, §12.4): the cloud cannot see tickets |
| E1 edge: station removed while orders are in flight → warn admin | **Deferred to 03b** (§4.4) |
| E1 edge: same station name on two floors | **Overridden** by S10 (unique per branch; `location_label` says where); 17 pattern |
| E1 route AC1 station, prep, cook time, serve mode | 33 |
| E1 route AC2 stock time | 33, 35, 121 |
| E1 route AC4 batch program + stock program | 34, 29 |
| E1 route AC5 integer paisa | 33, 74 |
| E1 route edge: unconfigured station → validation error | 34 |
| E1 route edge: stock time 0 valid | 35 |
| E1 stock AC1 count at start, update any time | 59, 60, 116 |
| E1 stock AC2 manager view of countdown | 72, 77 |
| E1 stock AC6 no count → 0 (full cook time); a count from an earlier business day → 0 [ASSUMPTION] (S41) | 89, 116 |
| E0 menu AC1 categories, archive | 32, 38, 120 |
| E0 menu AC2 fields (image deferred S13) | 33 |
| E0 menu AC3 stock time | 33, 35 |
| E0 menu edge: zero-price item valid | 88 |
| E0 menu AC7 archived items gone from ordering, kept in history | 38 |
| E0 menu AC8 tax class on every item | **Overridden** by S34 (tax class optional; branch `tax_enabled`): 31, 33, 107, 108, 120 |
| E0 availability AC1 toggle, reflected on ordering screens within 5 s | 69, 73, 90, 91 |
| E0 PIN AC1 duplicate PINs rejected | **Dropped** by 00 M27 (duplicates allowed; salted hashes make detection impossible). No 01a or 01b test |
| E2 AC9 parking order type | **02's** (S10 v0.6: an order type with no table, F §5.9); no 01a test |
| Owner config changes are traceable (T2 audit, "who changed a price") | 80–84, 105 (CLI) |
| Only an owner who covers every branch changes tenant-wide data (S8, D30) | 117 |
| A cloud deploy that adds a snapshot field never freezes hubs (S27, S28) | 94, 95, 114 |
| A cloud restore never leaves hubs on a menu or staff list the cloud no longer has (S42) | 123 |
| Poll problems, including a failed apply, are visible on the hub (S29, S43) | 44, 50, 102, 115, 126 |
| E1 stock AC1 "start of service" / "Not counted today" uses the business day [ASSUMPTION] (S33) | 104 |
| Availability carried over between days is visible (S30) | 103 |
| [ASSUMPTION] Sold-out vs cook-fresh at stock 0 (S32): stored and delivered here; behaviour in 02 / 03a | 106 |
| Tax rate resolved at bill close; tax only when `tax_enabled` and a tax class (S31, S34); an archived class stays resolvable (S22) | Carried to 05. 01a delivers the data: 4, 107, 108 |
| Client build and release: one app, entries per surface, kit-only styling, hub ships the build from the same commit, on site (S35, S39) | 15, 78, 79, 113, 125; release drill (§11 step 29) |
| `@pos/engine` and the root of `@pos/domain` stay browser-safe (S35 k) | 127 |
| Carried: `registerStationValidator` | 57, 124 |
| Carried: cloud `idempotency_keys` (M69) | 9–14, 122 |
| Carried: BYOD auto-revoke on staff exit (R14) | 51, 115 |
| Carried: staff/role admin, PIN, `directory_version` bump; owner lockout notice | 01b, reserved tests 01b #1–#3 and #4 (§12.5) |
| Carried: E6 roles AC5 (role assignments and permission changes in the audit log) | 01b, reserved test 01b #5 (§12.5) |

---

## §11. Build order

Each task is TDD (failing test first) and is one commit citing its sections. v0.6 keeps the task numbers; task 28 is removed. v0.6.1 adds test 127 to task 24. The plan is re-baselined after the owner visit.

1. Spec 00 v1.2.1 editorial patch (docs only, S25) [§2, S25]
2. `@pos/domain`: append §9 codes to `errors.ts` and F §6.2; add `manage-stock` to `permissions.ts`; grant it to Owner and Manager in `default-roles.ts`; `business-day.ts` (`businessDayStartedAt`, root export); test 104 (numbered part) [§9, S18, S33]
3. `@pos/domain/hash`: move `canonicalJson`, `sha256hex` to `packages/domain/src/hash.ts` (subpath export in `package.json`), with `canonicalJson` throwing on `undefined`; hub `lib/hash.ts` re-exports them; existing hub hash and command tests still pass; test 114 (unit part) [S27]
4. `@pos/events`: `config.ts` (`SNAPSHOT_SCHEMA_VERSION = 1`, `BranchConfigSnapshotSchemaV1` with `is_archived` on programs and tax classes, not `.strict()`, S28), `BranchConfigApplied.v1`, `StockSet.v1`, `ItemMadeUnavailable.v1`, `ItemMadeAvailable.v1`, fixtures and builders [§4.2, §4.3, S22]
5. `packages/engine` (new package, F §6.9 folder): `state.ts`, `stock.ts` (`availableStock` with the business-day rule, the `≥ 0` invariant), `apply-event.ts`, `version.ts`, fixture `engine-state.v1.json`; tests 66, 68, 116 (unit part) [S14, S15, S41]
6. Cloud migration `0002_restaurant_setup.sql`, including `config_audit` and its trigger, `branches.business_day_start_ms` and `tax_enabled`, `menu_items.out_of_stock_behaviour`, nullable `tax_class_id`, `config_audit.actor_kind`; test 84 [§5.2, S26, S32, S33, S34]
7. Cloud `lib/idempotency.ts` (`withIdempotency`, request hash over method, path and body, prune after COMMIT); tests 9–14, 122 [S7]
8. Cloud `bumpConfigVersion` (S8 lock order, tenant-wide coverage check) and `lib/config-audit.ts` (`writeConfigAudit`); tests 7, 8 [S8, S26]
9. Cloud `modules/restaurant`: floors and tables §6.2–6.6, with audit rows; tests 16–23, 80, 83, 118 [§6 batch 1, §6.0]
10. Cloud stations and programs §6.8–6.10; tests 24–30, 86, 119 [§6 batch 2]
11. Cloud tax classes, categories §6.12–6.13; tests 31, 32, 120 [§6 batch 3]
12. Cloud menu items and routes §6.11, 6.14–6.16 (merged-row validation); tests 33–41, 81, 82, 87, 88, 106, 107, 117, 121 [§6 batch 3, §3.3, S8, S32, S34]
13. Cloud `modules/config-sync`: `GET /v1/sync/config` with `builder.ts`, the wire hash and the `REPEATABLE READ` transaction; tests 1–6, 85, 114 (cloud part) [§6.1, S4, S27, S28]
14. Cloud CLIs `cli/set-branch-settings.ts` (`--tax-enabled` only) and `cli/restore-bump.ts`; tests 105, 108, 123 (cloud part) [§6.7, §6.7a, S34, S42, M56]
15. Hub migration `0004_restaurant_config.sql`; projections `branch-config.ts`, `item-availability.ts` (times from `recorded_at`); test 49 [§5.1]
16. Hub `sync/config-poller.ts` (`pollOnce`, apply, swap, `onBranchConfigApplied`, S43 failure path), boot step 6 timer; `QueryCtx.state` / `.branchConfig`; raw-JSON hash before parse, one schema version, forward-only rule, `last_problem`; tests 42–47, 50, 53, 54, 58, 94, 95, 115, 126 [§3.4, S5, S6, S16, S28, S29, S43]
17. Hub body-missing path (`BODY_MISSING`); directory-through-poll tests 48, 51, 52, 123 (hub part) [S5, S6, S42]
18. Hub `sync/station-validator.ts`; test 57 [§6.22]
19. Hub boot: `BootContext.initialState`, `createDeps` takes it, `state.setReducer(applyEvent)` at `lib/boot.ts:279`, boot step 3 stock fold, boot step 5 config load; tests 67, 93, 124 [S15, §2]
20. Hub `SetPrecookedStock` (a `StockSet` for every entry); tests 59–65 [§6.17]
21. Hub `SetItemAvailability`, `itemAvailability`; tests 69–71 [§6.18]
22. Hub queries stock and config status; tests 56, 72, 89, 102, 103, 116 (hub part) (server parts) [§6.19, §6.21, S29, S30, S33, S41]
23. Hub WS audiences and catch-up parts, `GET /queries/branch-config`; tests 73, 90, 91, 92 [§4.5, §6.23]
24. `apps/client` scaffold: `package.json` with the closed S35 g list, `vite.config.ts` (one mode per entry, `assetsInlineLimit: 0`, manifest on), two entry `index.html` files, `src/app/` hash routes, `ui-kit.ts` and `ulid.ts`, the jsdom Vitest project, ESLint rules from S35 d, e and f, and the browser-safe block for `packages/engine` and `packages/domain` (S35 k); root `pnpm test` builds first; root `engines.node` raised to `>=22.22.2 <23` (jsdom, S35 g); tests 75 (page part: lint), 79, 113, 125, 127 [S35, S39 a]
25. `client-dist` helper (hub + cloud, path from S39 b, bodies in memory, CSP on both), cloud `/owner/*` allowlist; `apps/hub/deploy/ship-client.sh` (§7.8, refuses while the hub is active); tests 15, 78 [§7.1, §7.8, S21, S35, S39]
26. Owner app: login, floors, stations, menu, `money.ts`, `api/cloud-admin.ts`; tests 74, 75, 76 [§8.1]
27. Hub `/admin/stock` app with the admin login from the shared `StaffTiles` and `PinPad` (S35 i), the status line and problem banner, touched-row save with Confirm, "Off since", `api/hub-admin.ts`; tests 77, and the page parts of 102, 103, 104 [§8.2]
28. **Removed in v0.6** (directory resend on epoch change, S36).
29. Manual runbook: owner creates a branch menu; hub pulls it; KDS pairs to a station; manager sets stock offline (internet unplugged); a count from yesterday shows Available 0 after the business-day start; cloud restore drill: restore an older cloud dump, see the hub ignore it, run `restore-bump`, and see the hub apply the older menu and the older staff directory; release drill: §7.8 steps 1–6 on site against a hub checkout (the pilot mini PC or any `ssh` target on the LAN), including one refusal (dirty tree, hub still active, or different commit); the page parts of tests 75, 102, 103 and 104, which are also automated (S40 N11): a scratch `dangerouslySetInnerHTML` fails `pnpm lint`; the stock page's danger banner; "Off since" and "Not counted today" badges around the business-day start; and the §7.5 timings (S40 N10) [§10.6, S39, S40, S41, S42]

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done
- Every numbered test 1–127 except those **removed in v0.6** (55, 96–101, 109–112) has exactly one test citing it; all pass in CI (hub SQLite, cloud PostgreSQL 16). No test cites a removed number.
- Route-inventory and cross-tenant tests pass with the new routes and the `config_audit` table (D54).
- Every owner config write in §6.0 writes its `config_audit` row in the same transaction (tests 80–84).
- Spec 00 v1.2.1 editorial patch applied (S25). Spec 00 needs **no** behaviour change (v0.6: S36 and its 00 v1.3 entry are withdrawn).
- §9 codes are in `errors.ts` and F §6.2; `manage-stock` is in the catalogue and the default roles.
- README updated: module map (01a, 01b), milestones (01b before the first live order), requirements carried (§4.4), 00 drift notes (§2).
- Runbook (task 29) done on the dev box: a cloud menu edit reaches the hub within 60 s; a KDS pairs to a station; stock entry works with the internet down; the restore drill with `restore-bump` reaches the hub; the release drill (§7.8) ends with `/admin/stock/` → `200` with the CSP header on the hub.
- The cloud restore runbook (06 / ops) includes `restore-bump` and the re-apply of staff changes made after the backup (S42).
- **Dependencies:** none new in `apps/hub`, `apps/cloud` or `packages/*`, except the dev-only `@types/node` 22.19.1 in `packages/domain` for `hash.ts` (S27, S40 N1), and the workspace dependency `@pos/engine: workspace:*` in `apps/hub` (and in `apps/client`, S35 f), which is a workspace package, not a new library. In `apps/client` only, the closed, pinned list of S35 g: `react`, `react-dom` (runtime), and `vite`, `@types/react`, `@types/react-dom`, `jsdom` (dev); no router, state, form or CSS library. CLAUDE.md's "no extra dependencies" rule is met by this recorded decision. Root `engines.node` is `>=22.22.2 <23`.
- Build and release (S39, §7.8): `ship-client.sh` exists; the hub and cloud serve `apps/client/dist/<entry>/` with the CSP header; the deploy notes in §7.8 are the release procedure (on site, outside service hours).

### 12.2 Endpoint checklist

| # | Route / command | Auth | Permission | Idempotency | Tests |
|---|---|---|---|---|---|
| 6.1 | `GET /v1/sync/config` | branch key | — | read | 1–6, 85, 114 |
| 6.2 | `GET /v1/admin/branches/:b/floors` | JWT | owner | read | 16 |
| 6.3 | `POST …/floors` | JWT | owner | key | 16, 17, 80, 83, 122 |
| 6.4 | `PATCH …/floors/:id` | JWT | owner | PATCH | 17–19 |
| 6.5 | `POST …/tables` | JWT | owner | key | 20, 21 |
| 6.6 | `PATCH …/tables/:id` | JWT | owner | PATCH | 22, 118 |
| 6.8 | `GET …/stations` | JWT | owner | read | 24 |
| 6.9 | `POST` / `PATCH …/stations` | JWT | owner | key / PATCH | 24–27, 82, 86 |
| 6.10 | `POST` / `PATCH …/programs` | JWT | owner | key / PATCH | 28–30, 87, 119 |
| 6.11 | `GET /v1/admin/menu` | JWT | owner | read | 40 |
| 6.12 | tax classes `POST` / `PATCH` | JWT | owner covering every branch | key / PATCH | 31, 117, 120 |
| 6.13 | categories `POST` / `PATCH` | JWT | owner covering every branch | key / PATCH | 32, 82, 117, 120 |
| 6.14 | `POST /v1/admin/menu-items` | JWT | owner covering every branch | key | 33–37, 41, 87, 88, 106, 107, 117 |
| 6.15 | `PATCH /v1/admin/menu-items/:id` | JWT | owner covering every branch | PATCH | 38, 81, 117, 121 |
| 6.16 | `PUT …/routes/:branch_id` | JWT | owner | PUT | 39, 82, 86 |
| 6.17 | `SetPrecookedStock` | admin session | `manage-stock` | `command_id` | 59–65 |
| 6.18 | `SetItemAvailability` | admin session | `manage-stock` | `command_id` | 69, 70, 90 |
| 6.19 | `GET /admin/queries/stock` | admin session | `manage-stock` | read | 72, 89, 103, 104, 116 |
| 6.20 | — | — | — | — | removed in v0.6 (S24) |
| 6.21 | `GET /admin/queries/config-status` | admin session | `access-hub-admin` | read | 56, 102 |
| 6.23 | `GET /queries/branch-config` | staff or station session | — (any session) | read | 92 |

CLIs (not endpoints): `set-branch-settings` (§6.7) tests 105, 108; `restore-bump` (§6.7a) test 123.

### 12.3 Open questions (developer)
| # | Question | Blocks |
|---|---|---|
| Q1 | A head cook who enters stock needs `access-hub-admin` to open `/admin/stock` (S18). Is that acceptable, or should 02's client get a staff-session stock screen? | Nothing in 01a. **Open until owner question 8** (S38) |
| Q2 | **Resolved in v0.2 (S25).** Behaviour is identical, so spec 00 is patched editorially to v1.2.1 to match the code (exact lines in S25). `QueryCtx.state` / `.branchConfig` stay 01a's own additive change (S16). | — |
| Q3 | **Closed in v0.4 (S37):** `GET /v1/admin/branches` is 01b's (§12.5); until then the branch picker shows IDs. | — |
| Q4 | **Closed in v0.4, re-decided in v0.6 (S42):** after a cloud restore, `restore-bump` raises `tenants.directory_version`, so every hub takes the restored directory under the unchanged M51 rule. The restore runbook re-applies staff changes made after the backup. | — |

### 12.4 Deferred until needed
| Item | Trigger |
|---|---|
| Floor canvas, table shape, `pos_x` / `pos_y` (S9) | Owner asks for a visual map after the pilot |
| Item images (S13) | Owner asks for photos on screens or a customer menu (P2 E9) |
| Optimistic concurrency on owner PATCH (S23) | More than one person edits the menu |
| `config_snapshots` pruning | Hub disk use from snapshots > 1 GB, or 03a's checkpoint makes old bodies unreachable |
| Shared `client-dist` helper between hub and cloud (§7.1) | The two copies differ in a bug fix |
| Per-branch prices (E0 P2 price lists) | Owner answer to question 5 |
| Bulk table create | More than one new branch to set up |
| Warn about in-flight tickets when a station is archived (E1 floors AC6, edge case) | **Owned by 03b** (§4.4): the hub sees tickets, the cloud does not. Built with 03b's KDS through `onBranchConfigApplied` |
| Read endpoint and owner page for `config_audit` (S26) | Owner asks "who changed this price"; until then it is answered with a SQL query on the cloud database |
| Snapshot schema negotiation between cloud and hub versions (S28 b/e, cut in v0.6) | Hubs can no longer be upgraded together with the cloud (more tenants, remote updates, milestone C) |
| "Get changes now" button (`pull-now`, S24, cut in v0.6) | The owner asks for menu changes faster than the 60 s poll |
| Setting `business_day_start_ms` (cut from the 01a CLI in v0.6) | Owner answer to question 11; the setting itself is 01b's endpoint |

### 12.5 01b scope list (not written in this draft)
Required for milestone A, before the first live order (S2); built alongside 02.
- Cloud roles from the permission catalogue (list, create, edit, archive); E6 AC1, 2, 5 (audit of role changes), 7 (last `access-hub-admin` guard, 00 M57; owner cannot remove their own admin access).
- Staff CRUD, staff-to-branch assignment (`staff_branches`), `is_active` for exit (exit → removed from the directory → 01a's poll ends sessions and revokes the BYOD phone, 01a test 51).
- PIN set/reset: 4–6 digits sent over HTTPS, hashed with argon2id **on the cloud** at 00 M8 parameters or stronger, never a hash the hub would skip under M52. This overrides D40 / F §3.1 "hashed on the setting device" and must be recorded in 01b as a named decision. PIN reset ends sessions through M50.
- `tenants.directory_version` bump on every staff/role change (00 M51), strictly upward; `restore-bump` (01a S42) raises it after a cloud restore.
- Audit staff removals and PIN resets, so the restore runbook can re-apply them after `restore-bump` (S42).
- Out-of-band owner lockout notice (00 M73): dashboard notice on the next successful login, plus e-mail if a sender exists.
- **`GET /v1/admin/branches`** (confirmed here, S37: `{ branches: [{ branch_id, name, status }] }` for the JWT's `allowed_branch_ids`, 1 statement) and **`PATCH /v1/admin/branches/:branch_id/settings { tax_enabled?, business_day_start_ms? }`**: owner-only, common write script, `config_audit` row `branch_settings` / `update` (`actor_kind 'owner'`), bump that branch (01a §6.7, S33, S34), plus a branch settings view. Staff/role owner views in the `apps/client` owner entry (S35); `withIdempotency` on creates.
- Possibly, after the owner visit: modifiers/add-ons/combos (S12) and scheduled availability (E0 availability AC4–5) — or a separate 01c if 01b would exceed the size budget.
- **Reserved 01b test numbers for carried items:** 01b #1 role CRUD from the catalogue + last-admin guard; 01b #2 staff CRUD + branch assignment + `directory_version` bump; 01b #3 PIN set/reset produces an M8-valid argon2id hash that 00's `applyStaffDirectory` accepts (not skipped under M52) and ends sessions (M50); 01b #4 locked owner account → notice shown on the next successful login (M73); 01b #5 E6 roles AC5: every role create/edit/archive, permission change and role assignment writes one audit row in the same transaction, with actor, before and after.
- Not in 01b: E0 PIN AC1 (duplicate PINs rejected) is dropped by 00 M27. Duplicates are allowed, because salted hashes make detection impossible.

### 12.6 Owner questions for the visit
Each question names the decisions that wait on its answer.
1. Do you serve customers in cars (parking)? Roughly how many spots, and are they numbered? (02's parking order type; S10 no longer depends on it)
2. Which extras do customers ask for most (extra naan, extra nalli, less spicy…)? Are they paid or free? (S12)
3. How is pre-cooked stock counted: plates, pieces, or kg per pot? When the paye or another pre-cooked pot runs out, is the item sold out for the day, or do you cook more? Which items are which? (S14, S32)
4. Is leftover pre-cooked food sold the next morning, or thrown away at closing? If an item is switched off at night, should it be back on automatically in the morning? (S41, S30)
5. Is the menu and every price the same at all three branches? Is any item sold at only one branch? (S11)
6. How many menu items do you have, how many come in half/full or sizes, and do you sell deals or combos today? (S12, §6.11)
7. Do you charge tax at all today? At every branch? On cash and card both? If yes: what rate(s), do your menu prices already include tax, and do you issue PRA receipts today (OQ15)? (S31, S34, §4.4 05)
8. Who counts the pre-cooked stock in the morning: the manager or the head cook? (S18, Q1)
9. Do some items run only part of the day or week (breakfast, Friday specials)? (scheduled availability, 01b)
10. In the kitchen, which items are cooked several at once in one load (fryer, tandoor), and how long does each load take? (station and program data)
11. What time does the restaurant open and close? Does the day run past midnight? (S33)

### 12.7 Assumption isolation (v0.6)
Each [ASSUMPTION] and the one place a different owner answer changes.

| Assumption | Owner question | The one place that changes |
|---|---|---|
| Parking | 1 | Not 01a's any more: 02's order-type model (S10 v0.6 follows F §5.9 and E2 AC9) |
| Free requests in a kitchen note, no modifiers (S12) | 2, 6 | 01b scope list (§12.5); 01a's snapshot gains optional fields within schema 1 (S28 c) or a coordinated new version |
| `out_of_stock_behaviour` (S32) | 3 | The column default; if every item is `cook_fresh`, nothing else changes (02 and 03a already branch on the value) |
| A count is valid for one business day (S41) | 4 | `availableStock` in `@pos/engine` only; hub, stock query, catch-up and clients all call it |
| Availability carries over between days (S30) | 4 | The availability projection read in §6.19 / `itemAvailability`; no other module stores it |
| Same menu and prices at every branch (S11) | 5 | Per-branch prices are deferred (§12.4); routes are already per branch |
| Tax optional, rate at bill close (S31, S34) | 7 | 05's spec; 01a only stores the class, its rate and `tax_enabled` |
| Who counts stock (S38, Q1) | 8 | The permission on §6.17 / §6.19, or a staff-session screen in 02 |
| Business day starts 05:00 (S33) | 11 | The column default, changed per branch through 01b's settings endpoint; every reader uses `businessDayStartedAt` |
