# 01a — Restaurant Setup (restaurant data + config delivery) — Module Spec v0.3

## §1. Header

| Field | Value |
|-------|-------|
| Module | 01a Restaurant Setup: restaurant data and config delivery. 01b (staff and role admin) is a separate spec; its scope is listed in §12.5 |
| Version | v0.3 — **DRAFT** (2026-10-25). Not reviewed. Pipeline step 4 (hostile review in a fresh session) comes next. v0.3 over v0.2: snapshot schema versioning, with the hash checked over the raw JSON (S28); `config_epoch` against version regression after a cloud restore, with visible poll problems (S29); "Off since" for availability carried across days (S30); tax rate resolved at bill close (S31); [ASSUMPTION] `out_of_stock_behaviour` (S32) and `business_day_start_ms` (S33); optional tax: nullable `tax_class_id` and `branches.tax_enabled` (S34); both branch settings set by the CLI `set-branch-settings` in 01a, owner endpoint in 01b (§6.7); owner questions merged (§12.6); tests 94–108. v0.2 over v0.1: endpoint count corrected; S10 override of the E1 station-name edge case; WS pushes and catch-up parts (§4.5); cloud `config_audit` (S26); `canonicalJson` / `sha256hex` in `@pos/domain/hash` (S27); `set_at` in the stock slice (S14); 00 drift decided (S25); permission/audit table (§6.0); tests 80–93 |
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
- Cloud canonical restaurant data: floors, tables (including parking spots), stations, batch programs, tax classes, categories, menu items, and per-branch item routes (§5.2).
- Cloud owner pages for that data (§8.1).
- The cloud `idempotency_keys` store for every creating `POST` (S7).
- The cloud `config_audit` trail for every owner config write (S26).
- Config delivery: `GET /v1/sync/config` with a conditional `304`; the hub poller; the `BranchConfigApplied` event with a content-addressed snapshot store; the staff directory delivered by the same poll through 00's `applyStaffDirectory` (S3–S6).
- Hub: `registerStationValidator`; the in-memory branch config; pre-cooked stock entry (`StockSet`) and the stock slice of the engine fold (S14, S15); the manual item availability toggle (S17); one hub admin page for stock and availability (§8.2).
- **Staff in dev and test come only from `seed-tenant` (00 §6.26) until 01b ships.** 01a reads staff only through the directory that 00 already builds.

### Out of scope
- Staff/role admin, PIN set/reset, staff-to-branch assignment, the last-admin guard, the owner lockout notice → **01b** (§12.5).
- Live station capacity override (D37), `StockReserved` / `StockReleased`, ETA recalculation on a stock change (D23), and the engine's reaction to a station config change → **03a**.
- Table state, the table map, order lines, the ordering-screen stock countdown, unavailable items shown greyed out → **02**.
- Tax arithmetic, rounding, resolving the rate at bill close and payment-method tax rules → **05** (S31, S34). 01a stores only an optional tax class, its rate, and the branch's `tax_enabled` flag.
- Owner endpoint for branch settings (`tax_enabled`, `business_day_start_ms`) → **01b**, with `GET /v1/admin/branches` (§12.5). 01a sets them only through the CLI `set-branch-settings`.
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
| §4.2 line 472: `defineQuery` … `handle(ctx)`; "`ctx.db` is a read-only connection" | `QueryCtx = { db, page, directory, device, session }` (`queries/registry.ts:12`) | — (01a's own `state` and `config` fields are an additive change owned by 01a, S16, not drift) |

Not drift: F §6.9 lists `packages/engine/src/`; the package does not exist yet. 01a creates it with the stock slice only (S15), and 03a fills the rest.

---

## §3. Domain rules

### 3.1 Module decisions

Each decision states the failure it prevents and any foundation or 00 section it overrides.

| # | Decision | Prevents / reason | Overrides |
|---|---|---|---|
| S1 | **01 is split into 01a (this spec) and 01b (staff and role admin).** All of 01 in one spec is about 32 endpoints/commands, over the split threshold (README size budget). 01a holds what 02 and 03a build on. 01b writes only 00's existing tables (00 §5.2), so it can be built alongside 02. | One oversized spec on the critical path. | README module map (row 01 → 01a, 01b) |
| S2 | **01b is required for milestone A, before the first live order.** Until it ships, staff and PINs exist only through `seed-tenant`, for dev and test. | A pilot with CLI-made staff cannot reset a PIN or remove a fired employee. | README milestones |
| S3 | **Config pull, built in 01, reused by 06.** The hub polls `GET /v1/sync/config` every 60 s (and on "Get changes now", §6.20). Each 200 carries the **whole** branch snapshot (§4.3) and/or the staff directory. There is no `hub_push_queue` diff queue. | Milestone A has no 06 sync, so without this no menu change, PIN reset or staff removal would reach a hub after provisioning. A whole snapshot (< 200 items, ~60 KB) cannot get out of order, cannot lose a diff, and cannot apply half an edit. | F §3.3 mechanism ("cloud adds a record to `hub_push_queue`; hub fetches it on the next sync poll") |
| S4 | **Conditional GET.** The hub sends `config_epoch`, `config_version` and `directory_version` (and `snapshot_schema`, S28). When all three equal the cloud's, the cloud answers **`304 Not Modified` with no body**, after one SQL statement. | The restaurant is on mobile data; a full snapshot every 60 s is ~85 MB a day per branch. | F §6.1 "every response has a body (no 204)", for this route's 304 only |
| S5 | **Applying config is an event.** A new snapshot is applied in one `writer.run`: `INSERT OR IGNORE` the body into `config_snapshots` (content-addressed by `snapshot_hash`, insert-only, triggers block UPDATE and DELETE), append `BranchConfigApplied { config_epoch, config_version, snapshot_schema_version, snapshot_hash, previous_config_epoch, previous_config_version }`, and update the `branch_config` projection. The in-memory config swaps after COMMIT (D45). **How replay gets the body:** the `branch_config` projection keeps `snapshot_hash` from the last `BranchConfigApplied`; boot and replay read the body from `config_snapshots` by that hash. The table is in the hub database, so the USB backup carries it. After a **cloud-only** restore the events have the hash but no body: the projection then marks the body missing, the hub treats its `config_version` as 0, and the next poll fetches the current snapshot in full (§3.4 step 2). The hub opens `/auth/*` only after that poll (requirement on 06, §4.4). | A cache write outside the event log would make replay and restore build a different config from the live hub, and audit could not say which menu was live when. Keeping the body out of the payload keeps 60 KB rows out of the immutable log and out of sync traffic. | — |
| S6 | **The staff directory rides the same poll.** If the cloud's `tenants.directory_version` > the hub's, the 200 carries the directory, and the hub calls 00's `applyStaffDirectory(tx, directory)` **in the same `writer.run`** as any config apply. 01a is the first caller (00 §4.2 lists 06). M50, M51, M52, M75 and the M38 `owner_removed` phone revoke run unchanged. **Known limit:** while the branch is offline, a removed staff member keeps working on that hub until the next successful poll (§7.6). | Without it the BYOD exit revoke (R14) never fires in the pilot. | 00 §4.2 caller of `applyStaffDirectory` (01a, then 06) |
| S7 | **Cloud `idempotency_keys` (M69).** Every creating `POST` under `/v1/admin/*` requires `Idempotency-Key` (ULID). The key row is inserted **first, in the same transaction as the create**. A concurrent second request with the same key blocks on the primary key until the first commits, then reads the stored response. Same key + same request hash → stored status and body with `Idempotent-Replay: true`. Same key + different hash → `422 IDEMPOTENCY_KEY_MISMATCH`. Only successful responses are stored; a failed request rolls the key back. Rows older than 24 h are deleted for that tenant on each insert (index `idempotency_keys_age`). | F §6.4: an owner on mobile data retrying "add item" would create duplicates. Inserting first in the same transaction removes the need for an "in progress" state. | — |
| S8 | **Version bumps.** Every cloud config write bumps `branches.config_version` in the same transaction: the edited branch for branch-level data (floors, tables, stations, programs, routes), **every branch of the tenant** for tenant-level data (tax classes, categories, items). `UPDATE … RETURNING` also serialises concurrent config writes per branch. Lock order: the target row, then reference rows (`FOR SHARE`, in id order), then the branch rows last, in `branch_id` order (the tenant-wide bump first runs `SELECT … ORDER BY branch_id FOR UPDATE`), so two writes cannot deadlock. Directory bumps are 01b's (00 M51). | A per-tenant counter would make all three hubs download after a table rename at one of them. | — |
| S9 | **Floor editor narrowed:** floors (name, sort order, archive) and tables (name, floor, optional seats, sort order, archive). No canvas, shape or x/y. 02 shows tables as a tile grid per floor in sort order. Nullable `pos_x` / `pos_y` can be added later with a forward-only migration. | Nothing in E2–E8 reads a position; a canvas editor is the largest UI in the module. | E1 AC1 (2D canvas), AC2 (shape, position) — narrowed |
| S10 | **Stations belong to the branch, not to a floor.** Station names are unique per branch; an optional `location_label` ("Ground floor, back") says where it is. **Parking** is modelled as a floor (e.g. "Parking") whose tables are the spots (P1, P2, …, seats optional), so 02 needs no separate parking model [ASSUMPTION, owner question 1]. | The engine never reads a station's floor. With no floor on a station, "same name on a different floor" has nothing to tell the two apart on a KDS or ticket; the label says where the station is ("Fryer" + "Back kitchen"). | E1 AC3 (station "floor and position") — narrowed; **E1 edge case "two stations with the same name on different floors → allowed" — overridden**: station names are unique per branch (`409 CONFIG_NAME_TAKEN`), and `location_label` says where each station is |
| S11 | **Recipe route is per branch.** The menu (categories, items, prices, tax classes) is tenant-wide; each item has at most one route per branch (`item_routes`: station, and at a batch station a `program_id` and an optional `stock_program_id`). An item with no route at a branch is not sold there and is not in that branch's snapshot. A program is allowed only at a batch station, and a batch station requires one ("batchable" = routed to a batch station with a program). Same menu and prices at all branches [ASSUMPTION, owner question 5]. | Stations are per branch, so a tenant-wide route could point at another branch's fryer. | E1 route AC4 "marked batchable (yes/no)" → derived from the route |
| S12 | **No modifiers, add-ons or combos in 01a.** A variant is its own item ("Chicken Karahi — Half", "— Full") with its own price, route and stock count. An optional `group_label` ("Chicken Karahi") lets 02 show the variants side by side. Paid extras are plain items. Free requests go in 02's kitchen note (§4.4). Modifiers and combos go to the 01b scope list, decided after the owner visit [ASSUMPTION, owner questions 2, 6]. | Modifiers would add an order-line array to `OrderPlaced` before anyone knows whether the pilot menu needs it. | E0 menu AC4–6 deferred |
| S13 | **No item image or description upload in 01a.** `description` is an optional text field; images are deferred. | Uploads need object storage and an extra dependency; the order screen works without photos. | E0 menu AC2 (image) deferred |
| S14 | **Stock shape: on hand, reserved, set at.** `EngineState.stock: Record<ItemId, { on_hand: number; reserved: number; set_at: number \| null }>`, and **available = max(0, on_hand − reserved)**. `StockSet` sets the physical count the manager sees in the pot (`on_hand`), which still includes units reserved for orders not yet served. 01a's fold handles `StockSet` only: `on_hand = count`, `set_at = event.recorded_at` (from the event, so replay gives the same value), `reserved` unchanged (0 for a new item). An item with no entry reads as `{ on_hand: 0, reserved: 0, set_at: null }` (E1 stock AC6). `set_at` is for display only; the engine never reads it. 03a's `StockReserved` / `StockReleased` change `reserved`, and the step that hands a unit over moves it out of both. Everywhere F §4.7 says "pre-cooked stock > 0", it means `available > 0`. **Recorded race:** a count taken while a reserved unit is being plated can be off by that unit; the next count corrects it. | A single number set by the manager would erase reservations made between reading the screen and saving, and the same units would be sold twice. | F §4.7 `EngineState.stock: Record<ItemId, number>` and "pre-cooked stock > 0" |
| S15 | **01a creates `@pos/engine` with the stock slice only** (`state.ts`, `apply-event.ts`, `stock.ts`, `version.ts`), replaces the identity reducer and the `{}` initial state at `lib/boot.ts:278–279` with `initialEngineState()` and `applyEvent`, and registers a **boot step 3** that folds the `stock` stream (`StockSet` only) so counts survive a restart. 03a replaces that step with full replay and snapshots, and extends `applyEvent`. | Without a fold the manager's stock screen is empty until 03a, and a restart loses every count. | — (00 drift: `setReducer`, §2) |
| S16 | **`QueryCtx` gains `state` (read-only engine state) and `config` (the in-memory branch config).** | The stock query must read the one stock authority (D50) without a table. | 00 §4.2 `defineQuery` ctx (additive) |
| S25 | **00 drift (§2) is fixed by a 00 v1.2.1 editorial patch, with no behaviour change.** Exact edits to `00_Hub_Platform_Access_Spec_v1.2.md` (file renamed `…_v1.2.1.md`): **line 481** (§4.2 exports table): export name `registerReducer` → `state.setReducer(reducer)`; shape → "reducer `(state, event) => state`; one reducer, a later call replaces it; folded by the writer inside the transaction, and by replay (03a)"; used by → "01a, 03a". **Line 472** (`defineQuery` row): after "`ctx.db` is a read-only connection" add "; ctx = `{ db, page, directory, device, session }`". **Line 7** (version): "v1.2.1 — editorial (2026-10-25): §4.2 names match the code (01a S25); no behaviour change", and the README row. Behaviour checked: same signature; one reducer in both; the writer folds it (`writer.ts:79`); no replay in either yet. | The spec must match the code before 01a builds on it (CLAUDE.md: code and spec disagree → decide). | — (00 is not frozen; editorial patch) |
| S26 | **Cloud config audit trail.** Every owner config write (§6.3–6.16) inserts one `config_audit` row **in the same transaction** as the write, after it and before `bumpConfigVersion`: `actor_kind 'owner'` with `actor_owner_user_id` (JWT `sub`), or `actor_kind 'cli'` with no user for `set-branch-settings` (§6.7), `entity`, `entity_id`, `branch_id` (null for tenant-level data), `action` ∈ `create`, `update`, `archive`, `restore`, `route_set`, `route_removed`, and `before` / `after` (the row in its wire shape, without `tenant_id`; `before` is null on create, `after` is null on route removal). A PATCH that sets and archives in one request writes one row with action `archive` (or `restore`). Insert-only: triggers block UPDATE and DELETE (F §3.1 audit rule). An idempotent replay writes nothing (the stored response is returned). No read endpoint in 01a (§12.4). | T2 requires an audit trail for admin actions; a price change or an archived item must say who did it and when, and the hub's `BranchConfigApplied` says only which version was live. | — |
| S27 | **`canonicalJson` and `sha256hex` move to `@pos/domain/hash`** (`packages/domain/src/hash.ts`, a **subpath export**, not re-exported from the package root: it imports `node:crypto`, and 02's browser clients import `@pos/domain`). The hub's `lib/hash.ts` re-exports them and keeps `payloadHash`, so its importers do not change. The cloud's `/v1/sync/config` uses the same functions for `snapshot_hash`. The cloud Zod-parses the built snapshot with `BranchConfigSnapshotSchema` **before** hashing: `pg` returns `BIGINT` as a string, and a `"120000"` string would hash differently from the hub's parsed number. | Two hand-copied serialisers would drift, and every poll would be rejected as a hash mismatch (§3.4 step 4). | — |
| S28 | **Snapshot schema versioning; the hash is checked over the raw JSON.** (a) The snapshot carries `snapshot_schema_version` (1 in 01a). `@pos/events/src/config.ts` exports `SNAPSHOT_SCHEMA_MAX` (what this build can read) and one Zod schema per version. (b) The hub sends `snapshot_schema=<its SNAPSHOT_SCHEMA_MAX>`. The cloud keeps a builder for every version from `SNAPSHOT_SCHEMA_MIN_SERVED` to its own max and serves **`min(requested, cloud max)`**. If `requested < SNAPSHOT_SCHEMA_MIN_SERVED`, it answers `409 SNAPSHOT_SCHEMA_UNSUPPORTED`. The hub then keeps its last config and shows the problem (S29 c). The cloud raises `SNAPSHOT_SCHEMA_MIN_SERVED` only after every hub requests a higher version (3 known hubs; checked by hand from the cloud access log before the deploy). (c) **Within one schema version the cloud may only add optional fields.** Removing or renaming a field, changing its meaning, or adding one the hub must act on needs a new version. The hub's schemas are not `.strict()`, so Zod drops fields the hub does not know. (d) **Hash first, then parse.** The hub `JSON.parse`s the response text, takes `data.config.snapshot` as raw JSON, checks `sha256hex(canonicalJson(raw)) === snapshot_hash`, and only then Zod-parses it with the schema for its `snapshot_schema_version`. `config_snapshots.body` stores `canonicalJson(raw)`, unknown fields included, so the stored body always hashes to its key. Boot and replay parse the stored body the same way. (e) A hub that was upgraded and holds a snapshot older than its `SNAPSHOT_SCHEMA_MAX` sends `config_version=0`, so the next poll fetches the newer schema in full. | A cloud deploy that adds one field would otherwise change the hash the hub recomputes after Zod drops the field. Every hub would reject every snapshot and freeze on its last menu, with no error visible in the restaurant. | — |
| S29 | **Config epoch against version regression.** (a) `branches.config_epoch` is an opaque text, compared for equality only. It is set when the branch row is created (column default `gen_random_uuid()::text`, so 00's branch insert does not change) and replaced by a new ULID through the cloud CLI **`rotate-config-epoch`** (`apps/cloud/src/cli/`, `SystemContext`, M56). That CLI must run after any cloud database restore or reseed of an existing branch (requirement on 06 and the ops runbook, §4.4). The snapshot carries `config_epoch`, which is inside the hash. (b) The hub sends `config_epoch` (empty before the first apply). The cloud answers `304` only when the epoch and both versions match. **If the epoch differs, the hub applies the snapshot whatever its version** (outcome `epoch_changed`). Within one epoch the forward-only rule stays (§3.4 step 4). (c) **Poll problems are visible, not only logged:** the poller keeps `last_problem { outcome: 'rejected' \| 'upgrade_required' \| 'unauthorized', reason, at }` in memory until the next `applied` or `unchanged` poll. The `branch_config` projection keeps `epoch_changed_at`, set by a `BranchConfigApplied` whose `previous_config_epoch` is not null and differs from `config_epoch`. Config status (§6.21) returns both, and the stock page (§8.2) shows them as banners. | A cloud restore from yesterday's backup moves `config_version` back (e.g. 50 → 40). The hub would ignore every snapshot as "not newer" until the owner had made ten more edits, silently serving a menu the cloud no longer has. | — |
| S30 | **Availability carries over between days, and the page says so.** A manual `Off` stays off until someone turns it on; nothing resets it at the start of a day [ASSUMPTION, owner question 4]. The stock query returns `unavailable_since` (the projection's `changed_at` when `is_available = 0`), and the page shows **"Off since \<day\>"** when that is before the current business day (S33). | An item switched off at closing would silently stay off at the next lunch service. The label lets the manager notice it during the morning stock count. | — |
| S31 | **Tax rate is resolved at bill close, not copied at order time.** An order line copies `tax_class_id` (D25 "tax class"), not `rate_bp`. 05 resolves the rate from `branchConfig()` at bill close; the rate may depend on the payment method [ASSUMPTION, owner question 7]. Consequence: a rate change between order and bill applies to that open bill. 01a's snapshot keeps `tax_classes[].rate_bp` as the current rate; 05 may extend the tax class shape through a new snapshot schema version (S28). | Copying `rate_bp` at order time would bake in a rate that the payment method may change at bill close (cash vs card, owner question 7). | F §3.3 / D25 "subsequent menu changes apply only to future orders" — narrowed: a tax **rate** change applies to bills closed after it |
| S32 | **[ASSUMPTION, owner question 3] `out_of_stock_behaviour` per item:** `cook_fresh` (default: when available stock is 0 the full cook time applies, D7 / E1 stock AC5) or `sold_out` (when available stock is 0 the item cannot be ordered until the next `StockSet` > 0; e.g. paye cannot be cooked in minutes, karahi can). Stored on `menu_items` and carried in the snapshot. Used only where the item is stock-tracked at that branch (§4.3); ignored elsewhere, with no validation error, because stock tracking is per-branch. 01a stores and delivers it; 02 and 03a act on it (§4.4). If the owner says every item is `cook_fresh`, the column stays with its default. | Without it, a sold-out paye would be offered with a full cook time no kitchen can meet. | D7 / E1 stock AC5 ("switches to full cook time when stock reaches 0") — narrowed for `sold_out` items, pending the owner's answer |
| S33 | **[ASSUMPTION, owner question 11] Business day start per branch.** `branches.business_day_start_ms` (local time of day in ms, 0 … 86 340 000, a multiple of 60 000, default 18 000 000 = 05:00). Carried in the snapshot. In 01a it is set only through the cloud CLI `set-branch-settings` (§6.7); the owner endpoint is 01b's. The **current business day** starts at the most recent hub-local wall-clock time equal to it that is ≤ now (the hub's OS time zone, as v0.2's "midnight" used; Pakistan has no DST). The hub exposes `businessDayStartedAt(nowMs, config)` (`apps/hub/src/lib/business-day.ts`). "Not counted today" (§8.2) and "Off since" (S30) use it, not midnight. Carried to 05 for the Z report day (§4.4). | A restaurant open until 02:00 would see every count from 23:00 flagged "Not counted today" after midnight, and a Z report split at midnight would cut one service in two. | — |
| S34 | **Tax is optional, per item and per branch.** (a) `menu_items.tax_class_id` is **nullable**: null means the item is never taxed. (b) `branches.tax_enabled BOOLEAN NOT NULL DEFAULT false`, carried in the snapshot. When it is false, 05 applies no tax at that branch whatever the items say. (c) Tax applies to a line only when the branch has `tax_enabled` **and** the line has a `tax_class_id`. Payment-method rules (a different rate, or no tax, for cash vs card) are 05's, specified after OQ15 (§4.4). (d) In 01a, `tax_enabled` is set only through the cloud CLI `set-branch-settings` (§6.7; `seed-tenant` leaves the default). The owner endpoint is 01b's branch settings. [ASSUMPTION, owner question 7] | Many Pakistani restaurants charge no tax, some charge it only on card, and one branch may be registered while another is not. A required tax class would force a fake 0 % class on every item and could not express "this branch charges no tax". | **E0 menu AC8 "All items carry a tax class" — overridden**: the tax class is optional, and the branch flag can switch tax off |
| S17 | **Item availability is a hub event pair.** `SetItemAvailability { item_id, is_available }` appends `ItemMadeUnavailable` or `ItemMadeAvailable` (one fact each, F §6.6), or nothing if the item is already in that state. Projection `item_availability`; a missing row means available. | D26 makes availability hub-owned and offline. | — |
| S18 | **Stock and availability are hub admin commands** (`sessionKind: 'admin'`) under a new permission **`manage-stock`**, granted by default to Owner and Manager (`default-roles.ts`). In 01b, custom roles can give it to a head cook. They also need `access-hub-admin` to open the page. | Stock must work with the internet down (hub-owned, D50) and from one tablet. | — |
| S19 | **Owner pages are cloud-served, owner accounts only.** Menu, tax classes, stations, programs, floors and tables are edited on cloud pages (`/owner/*`) by `owner_users` (00 JWT). Managers do not log in to the cloud in P1. Stock and availability live on the hub page `/admin/stock`. | The cloud owns the menu (F §3.1) and editing it needs no offline mode; the hub owns stock and availability, and the stock count must work offline. | — |
| S20 | **New pages are static `.html` + ES-module `.js` files**, served from a file list read once at registration (the M81 pattern): `apps/hub/src/pages/` and `apps/cloud/src/pages/`. `<script type="module">`; no bundler, no framework, no new dependency. Page `.js` imports only relative page modules. The files are linted, and their logic is unit-tested by importing the modules into Vitest with the stub DOM from `apps/hub/test/helpers/page-sandbox.ts` (`node:vm` cannot load ES modules without `--experimental-vm-modules`). User text is set only through `textContent`. 00's pages stay as they are. | HTML and scripts inside TypeScript strings caused 00's `\s` escaping bug, and the menu editor is far larger than 00's pages. | F §6.9 folder list (adds `src/pages/` to both apps) |
| S21 | **Cloud pages and UI kit are served without tenant scope.** `GET /owner/*` and `GET /ui/*` on the cloud are static, embed no data and set `tenantScope: 'none'`; both prefixes join the allowlist. Data comes only from `/v1/admin/*` under the JWT. Pages are sent with `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`. | The JWT lives in `sessionStorage` on an internet-facing page; a script injected through an item name would steal it. | F §3.4 item 1 (allowlist) |
| S22 | **Archive, never delete.** Floors, tables, stations, programs, tax classes, categories and items are archived (`archived_at`) and can be restored. Archiving something still in use is refused with `409 CONFIG_IN_USE` (a floor with active tables, a station or program with active routes, a category or tax class with active items). An archived item disappears from new orders; open orders keep their copied lines (§4.4). Archived **stations** stay in the snapshot with `is_archived: true`, so KDS tickets already routed to them still render; `registerStationValidator` refuses them for new pairings. | Hard deletes would break history (E0 AC7) and the D25 copies' references. | — |
| S23 | **Last write wins on PATCH.** Two owner sessions editing the same row overwrite field by field; no ETag. | One owner, a handful of edits a day; optimistic locking fails the YAGNI test. | — |
| S24 | **`POST /admin/config/pull-now` is an admin route outside the command registry.** It writes only through `writer.run` inside the poll (§3.4), never in a handler. | A command handler is synchronous and runs inside the transaction, so it cannot wait on the cloud. | F §6.3 route groups (adds one admin route, like 00 M55 d) |

### 3.2 Branch config lifecycle (hub)

```
            boot: branch_config row?                  poll 200 with config, raw hash verified,
  ┌──────────┐  no row        ┌────────────────┐  and (epoch differs OR version > current
  │  start   │──────────────► │ NONE (v = 0)   │   OR body missing) ──────────────────┐
  └──────────┘                └────────────────┘                                   ▼
        │ row + body found                                                ┌──────────────┐
        └────────────────────────────────────────────────────────────────►│ APPLIED (vN) │◄─┐
        │ row, body missing (cloud-only restore)                          └──────────────┘  │
        ▼                                                                        │          │
  ┌────────────────────┐   next poll sends config_version=0                      │ poll 200 │
  │ BODY_MISSING (v=0) │──────────────────────────────────────────────────────── ┘ v > N or ─┘
  └────────────────────┘                                                   epoch changed (S29)
  NONE / BODY_MISSING: stationExists() → false; /admin/queries/stock returns items: [].
  APPLIED stays APPLIED on rejected / upgrade_required / offline polls (last config kept, S29 c).
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
| `business_day_start_ms` integer 0 … 86 340 000, multiple of 60 000 (S33) | `400` |
| Path `branch_id` must be in the JWT's `allowed_branch_ids` | `404 BRANCH_NOT_FOUND` |

### 3.4 Config poll (hub, `apps/hub/src/sync/config-poller.ts`)

Runs every 60 000 ms from boot step 6 and on `/admin/config/pull-now`. One poll runs at a time; a request during a poll waits for its result.
1. Skip if the hub is not provisioned or not yet confirmed (00 M41).
2. `current_config_epoch` = the `branch_config` row's epoch, or empty if there is no row. `current_config_version` = the row's version, or **0** if there is no row, `config_snapshots` has no body for its hash, or the row's `snapshot_schema_version` < `SNAPSHOT_SCHEMA_MAX` (S28 e). `current_directory_version` = `staff_directory_meta.directory_version`.
3. `GET /v1/sync/config?config_epoch=…&config_version=…&directory_version=…&snapshot_schema=<SNAPSHOT_SCHEMA_MAX>`, `Authorization: Bearer <branch_api_key>`, timeout 10 000 ms. Network error, timeout or 5xx → record `{ outcome: 'offline', at }`, stop. `401` → `last_problem { outcome: 'unauthorized' }`, log an error, stop. `409 SNAPSHOT_SCHEMA_UNSUPPORTED` → `last_problem { outcome: 'upgrade_required', reason: details }`, log an error, stop. In each case the hub stays on its last config. `304` → record `unchanged`, clear `last_problem`, stop.
4. `200`: `JSON.parse` the text, then Zod-parse the envelope with `config.snapshot` typed as raw JSON (`z.record(z.string(), z.unknown())`). Malformed → `last_problem { outcome: 'rejected', reason: 'malformed' }`, stop (nothing written). For `config`, in this order (S28 d): (i) `sha256hex(canonicalJson(raw))` ≠ `snapshot_hash` → reject the config part (`reason: 'hash_mismatch'`); (ii) `raw.snapshot_schema_version` > `SNAPSHOT_SCHEMA_MAX` → reject (`'schema_too_new'`; the cloud should never send it); (iii) Zod-parse with that version's schema (unknown fields dropped) → failure rejects (`'schema_invalid'`); (iv) **epoch rule (S29 b):** if `config_epoch` ≠ `current_config_epoch`, apply whatever the version (`epoch_changed`); else if `config_version ≤ current_config_version`, ignore the config part (forward only, the M51 pattern). A rejected config part still lets the directory part apply.
5. If nothing is left to apply, stop. Otherwise one `writer.run`: (a) config part: `INSERT OR IGNORE INTO config_snapshots (snapshot_hash, …, body = canonicalJson(raw))`, append `BranchConfigApplied` (`actor_id` null, `device_id 'hub'`); the projection writes `branch_config`. (b) directory part: `applyStaffDirectory(tx, directory)`.
6. After COMMIT, swap the in-memory config (D45); 00 swaps the directory itself. Record `{ outcome: 'applied' | 'epoch_changed', config_version, directory_version, at }`, and clear `last_problem` unless the config part was rejected in this poll.

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| Foundation | Envelopes, Shared Standards, `PosEvent`, `stream_type 'stock'` and `'hub'` |
| 00 hub | `defineCommand`, `defineQuery`, `writer.run`, `registerProjection`, `registerBootStep('3' \| '6')`, `registerStationValidator`, `applyStaffDirectory`, `state.setReducer`, `registerCatchUp`, `registerEventAudience`, `registerUiAssets` pattern, branch API key in hub config, `ids`, `clock` |
| 00 shared (moved by 01a, S27) | `canonicalJson`, `sha256hex` from `@pos/domain/hash` (hub and cloud) |
| 00 cloud | `tenant-scope` (JWT and `branch-key` scopes), `TenantScopedRepository`, `TenantLevelRepository`, `loadDirectory` (directory builder used by `/hubs/register`), error handler, migrations runner, `default-roles.ts`, owner login (`/v1/auth/*`) |

### 4.2 Exposes (later modules may rely only on these)

**Hub (`apps/hub/src`):**

| Export | Shape | Used by |
|---|---|---|
| `branchConfig()` | `() => BranchConfig \| null` (§4.3 snapshot, parsed; `null` before the first apply); swapped after commit | 02, 03a, 03b, 05 |
| `onBranchConfigApplied(fn)` | `fn(prev: BranchConfig \| null, next: BranchConfig)` runs **inside** the applying `writer.run`, before COMMIT, so a module can append its own reaction events in the same transaction | 03a (station capacity/program changes) |
| `itemAvailability(db, itemIds)` | `Map<item_id, boolean>`; one SQL statement | 02 |
| `businessDayStartedAt(nowMs, config)` | `apps/hub/src/lib/business-day.ts`; Unix ms of the current business day's start (S33) | 05 (Z report), 02 |
| `SNAPSHOT_SCHEMA_MAX`, `BranchConfigSnapshotSchemaV1` | `@pos/events/src/config.ts` (S28); later modules add `V2…` by the S28 c rule | 05, 06 |
| `QueryCtx.state`, `QueryCtx.config` | read-only engine state; `branchConfig()` | 02, 03a |
| `GET /queries/branch-config` | current snapshot for staff and station clients (§6.23) | 02, 03b clients |
| WS catch-up parts `branch_config`, `availability`, `stock` | §4.5 | 02, 03b clients |
| `@pos/engine`: `EngineState` (contains `stock` only, S14), `applyEvent` (folds `StockSet`), `availableStock(state, itemId)` = `max(0, on_hand − reserved)`, `stockOf(state, itemId)` = the entry or `{ on_hand: 0, reserved: 0, set_at: null }`, `ENGINE_STATE_VERSION = 1` | 03a extends; does not change the stock shape |
| Permission `manage-stock` | `@pos/domain/src/permissions.ts`; default Owner and Manager | 01b UI |
| `@pos/domain/hash`: `canonicalJson`, `sha256hex` (S27) | server-only subpath export | hub, cloud, 06 |

**Events introduced (all `schema_version: 1`):**

| Event | `stream_type` / `stream_id` | Payload | Pushed to (§4.5) |
|---|---|---|---|
| `BranchConfigApplied` | `hub` / branch_id | `{ config_epoch, config_version, snapshot_schema_version, snapshot_hash, previous_config_epoch \| null, previous_config_version \| null }` | staff and station sockets |
| `StockSet` | `stock` / item_id | `{ item_id, on_hand }` | staff sockets |
| `ItemMadeUnavailable` | `stock` / item_id | `{ item_id }` | staff sockets |
| `ItemMadeAvailable` | `stock` / item_id | `{ item_id }` | staff sockets |

**Cloud:** `GET /v1/sync/config` (§6.1), stable for 06; the `idempotency` helper `withIdempotency(ctx, request, fn)` (`apps/cloud/src/lib/idempotency.ts`), used by every later creating `POST` (01b, 05); `bumpConfigVersion(tx, scope)`; `writeConfigAudit(tx, entry)` (`apps/cloud/src/lib/config-audit.ts`, S26).

### 4.3 Branch config snapshot (`@pos/events/src/config.ts`, `BranchConfigSnapshotSchemaV1`)

Arrays are sorted by `sort_order`, then id, so `canonicalJson` is stable. Only active rows, except stations (S22). `BranchConfigSnapshotSchema` in earlier sections means the schema for the snapshot's `snapshot_schema_version` (S28).

```json
{
  "snapshot_schema_version": 1,
  "config_epoch": "8b0f6c1e-3f7a-4c52-9d1e-5a4b2c7d9e10",
  "config_version": 42,
  "branch_id": "01JBF2A0000000000000BR0001",
  "currency_code": "PKR",
  "business_day_start_ms": 18000000,
  "tax_enabled": false,
  "floors": [
    { "floor_id": "01JC…F1", "name": "Ground", "sort_order": 1,
      "tables": [ { "table_id": "01JC…T1", "name": "T1", "seats": 4, "sort_order": 1 } ] },
    { "floor_id": "01JC…F2", "name": "Parking", "sort_order": 9,
      "tables": [ { "table_id": "01JC…P1", "name": "P1", "seats": null, "sort_order": 1 } ] }
  ],
  "stations": [
    { "station_id": "01JC…S1", "name": "Karahi", "location_label": null, "station_type": "slot",
      "capacity": 4, "freshness_window_ms": null, "completion_mode": "two_tap", "is_archived": false, "programs": [] },
    { "station_id": "01JC…S2", "name": "Fryer", "location_label": "Back kitchen", "station_type": "batch",
      "capacity": 8, "freshness_window_ms": 0, "completion_mode": "two_tap", "is_archived": false,
      "programs": [ { "program_id": "01JC…G1", "name": "Fry 180 °C", "cook_time_ms": 360000 },
                    { "program_id": "01JC…G2", "name": "Reheat", "cook_time_ms": 120000 } ] }
  ],
  "tax_classes": [ { "tax_class_id": "01JC…X1", "name": "Standard", "rate_bp": 1600 } ],
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

An item is **stock-tracked** at a branch when its route is at a slot station and `stock_time_ms` is not null, or at a batch station and `stock_program_id` is not null.

### 4.4 Requirements carried to other modules

| To | Requirement |
|---|---|
| 02 | **Mid-service safety:** an order line copies `item_id`, `name`, `price_minor`, `tax_class_id` (may be null, S34; **not** `rate_bp`, S31), `serve_mode`, `prep_buffer_ms`, `out_of_stock_behaviour` and the route (`station_id`, `cook_time_ms`, `stock_time_ms`, `program_id`, `stock_program_id`) from `branchConfig()` at order time (D25, plus the name). A config apply mid-service never changes an open order: a price change or an archived item affects new orders only. The tax rate is the exception: 05 resolves it at bill close (S31). |
| 02 | **[ASSUMPTION, S32]** A stock-tracked `sold_out` item with `availableStock = 0` is shown greyed out like an unavailable item, with its own label ("Sold out"), and an order line for it is refused with an 02-defined code. A `cook_fresh` item at 0 stays orderable at the full cook time (D7). |
| 02 | The order line carries an optional free-text **kitchen note** (≤ 80 characters, no price effect), printed on the kitchen ticket and shown on the KDS (with 03b). It covers "less spicy / no onion" without a modifier model. |
| 02 | Read availability through `itemAvailability`; stock through `availableStock`; refetch config on the `BranchConfigApplied` push. Variants are separate items grouped by `group_label`. Tables are shown as tiles per floor in `sort_order`, with no positions; parking spots are tables. |
| 03a | Extend `@pos/engine` without changing the stock shape (S14): `StockReserved` / `StockReleased` change `reserved`; the hand-over step moves units out of `on_hand` and `reserved`; ETA uses `availableStock > 0`. **[ASSUMPTION, S32]** for a `sold_out` item, `availableStock = 0` means "cannot be reserved", never "fall back to the full cook time"; first-submit-wins (E1 stock AC4) then refuses the second order instead of re-quoting it. Replace 01a's boot step 3 with full replay. Through `onBranchConfigApplied`, define what a changed station `capacity`, `station_type`, program `cook_time_ms` or an archived station does to live reservations (D37 recalculation, or new orders only). |
| 03b | KDS tickets for an archived station still render (S22). Print the kitchen note. **E1 floors AC6 and edge case "warn admin about in-flight tickets" (deferred from 01a):** the cloud cannot see tickets, so the warning belongs on the hub. Through `onBranchConfigApplied`, when `next` archives a station that has open tickets, show a warning on that station's KDS and on the hub admin page; the tickets complete normally. |
| 02, 03b clients | On connect, read `catch_up.state.branch_config` (§4.5); if its `snapshot_hash` differs from the cached one, fetch `GET /queries/branch-config` (§6.23). On a `BranchConfigApplied` frame, do the same. Apply `ItemMade*` and `StockSet` frames to the `availability` and `stock` parts. |
| 05 | **Tax at bill close (S31, S34):** tax applies to a line **only when** `branchConfig().tax_enabled` is true at bill close **and** the line's `tax_class_id` is not null. Otherwise the line carries zero tax. 05 then resolves the rate from `branchConfig()` at that moment. **Payment-method rules** (a different rate or no tax for cash vs card, PRA receipts) are 05's to specify after OQ15 (R13) [ASSUMPTION, owner question 7]. Inclusive/exclusive pricing and rounding are 05's. Today's tax class = `{ tax_class_id, name, rate_bp }`; a per-payment-method rate goes in a new snapshot schema version (S28 c). |
| 05 | **Business day (S33):** the Z report and day close use `businessDayStartedAt` with `business_day_start_ms`, not midnight [ASSUMPTION, owner question 11]. If leftover stock is thrown away at closing, day close writes `StockSet { on_hand: 0 }` per stock-tracked item; whether manual `Off` toggles reset then is the same question (S30, owner question 4). |
| 06 | Reuse `GET /v1/sync/config` and the poller; do not add a second config path. After any restore, run one config poll **before opening `/auth/*`**; a cloud-only restore leaves `config_snapshots` empty, so the poll fetches in full (S5). **After any cloud database restore or reseed, run `rotate-config-epoch` for every restored branch before hubs poll again** (S29); without it, a restored lower `config_version` is ignored by every hub. |
| 01b | Every staff/role write bumps `tenants.directory_version` (00 M51), so the next 01a poll delivers it. Use `withIdempotency` on creating `POST`s. |

### 4.5 WS pushes and catch-up (F §6.5)

**No new `WsServerMessage` member.** 01a's pushes are frames of the existing `event` member of the union in `@pos/events/src/ws.ts`. That member already carries any `event_type` with its payload, and both ends validate it. The payload schemas are the four event schemas in `@pos/events` (§4.2). The catch-up adds parts to the existing `catch_up.state` record, through `registerCatchUp`. `WsClientMessage` is unchanged.

```json
{ "type": "event", "seq": 20811, "event": { "event_id": "01JC…", "event_type": "ItemMadeUnavailable", "schema_version": 1, "payload": { "item_id": "01JC…I1" } } }
{ "type": "event", "seq": 20812, "event": { "event_id": "01JC…", "event_type": "BranchConfigApplied", "schema_version": 1, "payload": { "config_epoch": "8b0f6c1e-…", "config_version": 43, "snapshot_schema_version": 1, "snapshot_hash": "9f2c…", "previous_config_epoch": "8b0f6c1e-…", "previous_config_version": 42 } } }
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
| `stock` | staff | `{ [item_id]: { on_hand, reserved, available } }` for stock-tracked items in the config | `EngineState.stock` (the `state` argument) |

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
  config_epoch   TEXT    NOT NULL,              -- S29
  config_version INTEGER NOT NULL,
  snapshot_schema_version INTEGER NOT NULL,     -- S28 e
  snapshot_hash  TEXT    NOT NULL,              -- body looked up in config_snapshots (may be absent, S5)
  applied_at     INTEGER NOT NULL,
  epoch_changed_at INTEGER                      -- S29 c: last apply whose epoch differed from the previous one
);

CREATE TABLE item_availability (                -- projection of ItemMade{Una,A}vailable (rebuildable)
  item_id      TEXT    PRIMARY KEY,             -- itemAvailability(): WHERE item_id IN (…)
  is_available INTEGER NOT NULL CHECK (is_available IN (0,1)),
  changed_at   INTEGER NOT NULL,
  changed_by   TEXT                             -- actor_id
);
```

No stock table (D50). Boot reads `branch_config` and its body: 2 primary-key lookups.

### 5.2 Cloud (PostgreSQL 16) — `0002_restaurant_setup.sql`

Times `BIGINT` Unix ms; money `BIGINT` `_minor`. Tenant-level tables (M16 pattern, `TenantLevelRepository`): `tax_classes`, `categories`, `menu_items`, `idempotency_keys`, `config_audit`. Branch-level (`TenantScopedRepository`): the rest. Every index leads with `tenant_id`.

```sql
ALTER TABLE branches ADD COLUMN config_version BIGINT NOT NULL DEFAULT 1;    -- S8 (expand-only)
ALTER TABLE branches ADD COLUMN config_epoch TEXT NOT NULL
  DEFAULT gen_random_uuid()::text;                                           -- S29: backfills existing rows; new rows get one
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
CREATE INDEX idempotency_keys_age ON idempotency_keys (tenant_id, created_at); -- 24 h prune per tenant

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

All cloud routes are under `/v1`. Owner routes: JWT, tenant guard, and `branch_id` in `allowed_branch_ids` for branch paths. Every success is `{ data }`. Every creating `POST` runs through `withIdempotency` (S7). Every write runs in one transaction that ends with `bumpConfigVersion` (S8). Shared failure cases, not repeated per route: `400 VALIDATION_FAILED`, `401 JWT_INVALID`, `404 BRANCH_NOT_FOUND`, `422 IDEMPOTENCY_KEY_MISMATCH` (creating `POST`s).

**Common write script (cloud):** validate (Zod) → `BEGIN` → [creating `POST`: insert idempotency key; on conflict wait, then replay or `422`] → load and lock the target row `FOR UPDATE` (`404` if absent) → rule checks (§3.3; reference rows `FOR SHARE`, in id order) → write → `writeConfigAudit` (S26; `before` = the locked row, `after` = the written row) → `bumpConfigVersion` (branch rows last, S8) → [store the response on the key] → `COMMIT` → respond. A unique-index violation on an active name maps to `409 CONFIG_NAME_TAKEN { entity, name }`. Any failure rolls back the write, the audit row and the key together.

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
| 6.12 | `POST` / `PATCH /v1/admin/tax-classes` | owner | `tax_class` / `create`; `update`, `archive` or `restore` | every branch |
| 6.13 | `POST` / `PATCH /v1/admin/categories` | owner | `category` / `create`; `update`, `archive` or `restore` | every branch |
| 6.14 | `POST /v1/admin/menu-items` | owner (+ each route `branch_id` allowed) | `menu_item` / `create`, plus one `item_route` / `route_set` per route | every branch |
| 6.15 | `PATCH /v1/admin/menu-items/:id` | owner | `menu_item` / `update` (a price change: `before.price_minor`, `after.price_minor`), `archive` or `restore` | every branch |
| 6.16 | `PUT …/routes/:branch_id` | owner (+ `branch_id` allowed) | `item_route` / `route_set` or `route_removed` | that branch |

The reads (§6.2, 6.8, 6.11) write no audit row.

### Batch 1 — config delivery, floors and tables

#### 6.1 `GET /v1/sync/config` (branch API key, `tenantScope: 'branch-key'`)

| | |
|---|---|
| Query | `config_epoch` (string, may be empty), `config_version` (int ≥ 0), `directory_version` (int ≥ 0), `snapshot_schema` (int ≥ 1) |
| Script | (0) `snapshot_schema < SNAPSHOT_SCHEMA_MIN_SERVED` → `409 SNAPSHOT_SCHEMA_UNSUPPORTED` (S28 b), before any statement. Served version `v = min(snapshot_schema, cloud SNAPSHOT_SCHEMA_MAX)`. (1) One statement: `SELECT b.config_epoch, b.config_version, b.business_day_start_ms, b.tax_enabled, t.directory_version, t.currency_code FROM branches b JOIN tenants t …` for the key's branch. (2) Epoch, config version and directory version all equal the query → **`304`, no body** (S4). (3) If the epoch or `config_version` differs, build the snapshot with **builder `v`** in 6 fixed statements (floors + tables, stations + programs, tax classes, categories, items ⋈ routes for this branch). Parse it with that version's schema (numbers, not `BIGINT` strings, S27), and set `snapshot_hash = sha256hex(canonicalJson(snapshot))` from `@pos/domain/hash`. (4) If `directory_version ≠ query`, build the directory with 00's `loadDirectory` (5 statements). (5) Read-only; no transaction beyond `REPEATABLE READ` for the snapshot statements, so the snapshot is consistent. |
| Response | `200 { data: { config: { snapshot_hash, snapshot } \| null, directory: Directory \| null } }`; `snapshot.snapshot_schema_version = v`. The cloud answers `200` whenever the epoch or a version differs in either direction; the hub decides what to apply (§3.4 step 4). |
| Errors | `401 BRANCH_API_KEY_INVALID`; `400 VALIDATION_FAILED`; `409 SNAPSHOT_SCHEMA_UNSUPPORTED { requested, min_supported, max_supported }` |
| Queries | 1 (304), ≤ 12 (200) |

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

`pnpm --filter cloud set-branch-settings --branch <branch_id> [--tax-enabled true|false] [--business-day-start HH:MM]` (`apps/cloud/src/cli/set-branch-settings.ts`, `SystemContext`, M56). In one transaction it locks the `branches` row `FOR UPDATE`, validates (§3.3), updates the row, writes a `config_audit` row (`branch_settings` / `update`, `actor_kind 'cli'`, `before` / `after`) and bumps this branch (S8). The owner endpoint (`PATCH /v1/admin/branches/:branch_id/settings`) and its page are **01b's**, with `GET /v1/admin/branches` (§12.5). Bulk table create is not built (§12.4).

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
| Body | `{ category_id, tax_class_id, name, group_label?, description?, sort_order?, price_minor, serve_mode, prep_buffer_ms?, cook_time_ms, stock_time_ms?, out_of_stock_behaviour? (S32, default 'cook_fresh'), routes?: [{ branch_id, station_id, program_id?, stock_program_id? }] }`. `routes` has at most one entry per branch. |
| Script | common write script; reference checks lock the category, tax class, each station and each program `FOR SHARE`; insert the item and its routes; bump **every** branch (S8). |
| Response | `201 { data: { item } }` with `routes` |
| Errors | `409 CONFIG_NAME_TAKEN`; `422 CONFIG_REFERENCE_INVALID { field, reason }` (archived or foreign category, tax class, station, program; program rules §3.3; `stock_time_ms > cook_time_ms`); `404 BRANCH_NOT_FOUND` for a route branch outside `allowed_branch_ids` |
| Queries | fixed: 1 key insert + 1 per reference kind (`= ANY($ids)`) + 2 inserts + 1 audit insert (item and route rows in one multi-row `INSERT`) + 2 bump (lock, update) |

#### 6.15 `PATCH /v1/admin/menu-items/:item_id`

Any item field plus `archived`. Item fields only; routes use §6.16. Archiving needs no in-use check: open orders hold copies (§4.4), and the item disappears from the next snapshot. Bumps every branch. `404 MENU_ITEM_NOT_FOUND`; `409 CONFIG_NAME_TAKEN`; `422 CONFIG_REFERENCE_INVALID`.

#### 6.16 `PUT /v1/admin/menu-items/:item_id/routes/:branch_id`

Idempotent replace of the one route: body `{ station_id, program_id?, stock_program_id? }` sets it; `{ station_id: null }` removes it (the item is no longer sold at that branch). A `PUT` needs no `Idempotency-Key`: repeating it gives the same state (§6.4 applies to creating `POST`s). `200 { data: { route \| null } }`. Bumps that branch. Errors as §6.14.

### Batch 4 — hub

Hub commands follow F §6.3 and 00 §3.7. Each is `sessionKind: 'admin'`, permission `manage-stock` (S18), and none is `approvable`.

#### 6.17 `POST /admin/commands/set-precooked-stock` — `SetPrecookedStock`

| | |
|---|---|
| Payload | `{ entries: [{ item_id, on_hand: int 0…9 999 }] }`, 1–200 entries, unique `item_id` (duplicate → `400 VALIDATION_FAILED`) |
| Script | idempotency fast path → `BEGIN IMMEDIATE` → re-check → auth re-check (M39) → `manage-stock` → config present (else `404 MENU_ITEM_NOT_FOUND` for the first entry) → each entry: item in `branchConfig()` (else `404 MENU_ITEM_NOT_FOUND { item_id }`), stock-tracked (§4.3, else `422 STOCK_NOT_TRACKED { item_id }`) → one `StockSet` per entry whose `on_hand` differs from the current value → engine fold `applyEvent` for `nextState` → INSERT events + `processed_commands` → COMMIT → swap state (D45) → respond → push |
| Result | `{ items: [{ item_id, on_hand, reserved, available, set_at }] }` |
| Engine | touches `EngineState` → COMMIT-failure test required (F §6.7) |
| Note | 03a adds the D23 recalculation trigger to this command through `StockSet`; 01a does not recalculate. |

#### 6.18 `POST /admin/commands/set-item-availability` — `SetItemAvailability`

Payload `{ item_id, is_available: boolean }`. Item in config (else `404 MENU_ITEM_NOT_FOUND`). If the current state (projection; a missing row means available) equals the request → no event, `result: { item_id, is_available, changed: false }`. Else one `ItemMadeUnavailable` / `ItemMadeAvailable`; the projection is updated in the transaction. `changed: true`.

#### 6.19 `GET /admin/queries/stock`

`sessionKind: 'admin'`, session required, permission `manage-stock`. Reads `ctx.config` and `ctx.state` (S16); `on_hand`, `reserved` and `set_at` come from `stockOf(state, item_id)` (S14), so there is no event scan. One statement on `item_availability` (`is_available`, `changed_at`) for the config's items. Returns `{ config_version, applied_at, business_day_started_at, items: [{ item_id, name, group_label, category_id, is_stock_tracked, out_of_stock_behaviour, on_hand, reserved, available, set_at | null, is_available, unavailable_since | null }] }`, in config order. `business_day_started_at` = `businessDayStartedAt(now, config)` (S33); `unavailable_since` = `changed_at` when the item is off (S30). **1 statement.** With no config: `items: []`, `business_day_started_at` from the default 05:00, 0 statements.

#### 6.20 `POST /admin/config/pull-now`

A new admin route outside the command registry (S24). Guards: admin session and `access-hub-admin` (00 M61). It runs one poll (§3.4) and waits up to 12 000 ms. `200 { data: { outcome: 'applied' | 'unchanged', config_version, directory_version } }`; offline or timeout → `503 SERVICE_UNAVAILABLE { retry_after_ms: 60000 }`; cloud `401` → `503 SERVICE_UNAVAILABLE` too, logged as an error. Not a creating request; repeating it is harmless.

#### 6.21 `GET /admin/queries/config-status`

`sessionKind: 'admin'`, session required, permission **`access-hub-admin`** (the same guard as §6.20 and the `/admin/stock` page; §12.2 agrees). `{ config_epoch, config_version, snapshot_schema_version, applied_at, epoch_changed_at | null, directory_version, last_poll: { outcome, at } | null, last_problem: { outcome: 'rejected' | 'upgrade_required' | 'unauthorized', reason, at } | null }` from memory and 2 primary-key reads (S29 c). `outcome` ∈ `applied`, `epoch_changed`, `unchanged`, `offline`, `rejected`, `upgrade_required`, `unauthorized`. The page shows "Last checked 2 min ago · offline", plus the problem and epoch banners (§8.2).

#### 6.22 `registerStationValidator` (no route)

`(tx, stationId) => { const c = branchConfig(); return c !== null && c.stations.some(s => s.station_id === stationId && !s.is_archived) }`. It reads memory only; the single writer guarantees the config cannot swap mid-transaction. Registered at module load in `apps/hub/src/sync/station-validator.ts`, before the server listens.

#### 6.23 `GET /queries/branch-config`

`sessionKind: 'device'`, session required, `allowStation: true` (staff and KDS clients). No permission beyond a valid session: every client needs the menu, and the snapshot holds no secret. Returns `{ config_version, snapshot_hash, snapshot } | null` (null before the first apply) from memory: the in-memory holder keeps the parsed snapshot with its hash and version. 0 statements. Clients call it only when `catch_up.state.branch_config.snapshot_hash` or a `BranchConfigApplied` frame names a hash they do not hold (§4.5). This is the "clients refetch config" path that v0.1 named but did not define.

#### 6.24 Endpoint count

Cloud: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 6.9 ×2, 6.10 ×2, 6.11, 6.12 ×2, 6.13 ×2, 6.14, 6.15, 6.16 = **19** (v0.1 said 21 by mistake). Hub: 6.17–6.21 and 6.23 = **6**. **Total 25**: inside the 10–25 target. History: v0.1 had 24 (it stated 26 by mistake); v0.2 added §6.23; v0.3's branch settings endpoint moved to 01b (§6.7). The CLIs `rotate-config-epoch` and `set-branch-settings` are not endpoints. Static page routes (`/owner/*`, cloud `/ui/*`, hub `/admin/stock` and its `.js`) are not counted, as in 00 §6.33.

---

## §7. Cross-cutting

### 7.1 Static pages (S20, S21)
`apps/{hub,cloud}/src/lib/static-pages.ts`: reads `src/pages/**` once at registration. It serves `.html` (`text/html; charset=utf-8`, `Cache-Control: no-cache`) and `.js` (`text/javascript; charset=utf-8`, `?v=<hash>` + `immutable`, like M81). Any other path → `404 ROUTE_NOT_FOUND`. The cloud also serves `packages/ui-kit` under `/ui/*` through the same helper as M81, which moves to a shared location only if the two copies drift (§12.4). Hub pages: route group `admin-page` (host, provisioned, guest-network guards; no credentials, like M79). Cloud pages: CSP header (S21).

### 7.2 Poller timers
One `setInterval(60 000)` started at boot step 6 and cleared on shutdown, injectable for tests (§6.7 determinism: tests drive `pollOnce()` directly). Fixed interval: the cloud cost of a `304` is one indexed statement, so no backoff is needed. Bandwidth: 1 440 `304`s a day ≈ 1 MB/day per branch with headers.

### 7.3 Logging
The poller logs each outcome at `info` (unchanged at `debug`; `rejected`, `upgrade_required` and `unauthorized` at `error`, `epoch_changed` at `warn`). Logs are not the only signal: the same problems are shown on the stock page (S29 c). It never logs the snapshot body or the directory (the directory holds PIN hashes, 00 §7.2 redaction).

### 7.4 Rate limits
None new. `/v1/sync/config` is called once a minute by three known hubs; owner routes sit behind owner login (00 M64).

### 7.5 Performance targets
`304` path ≤ 20 ms p95 on the cloud; snapshot build ≤ 200 ms p95 for 300 items. Hub apply ≤ 100 ms (it blocks the writer; at the 60 s cadence and a few changes a day this is negligible). `SetPrecookedStock` with 200 entries ≤ 50 ms p95 on the mini PC.

### 7.6 Risks
| Risk | Accepted because | Mitigation |
|---|---|---|
| While the branch is offline, a removed staff member keeps working on that hub until the next successful poll (S6) | Pilot; the owner can also force-logout on the hub (00 §6.15) | Config status shows "offline since …"; the poll runs within 60 s of the internet returning |
| A stock count taken during plating is off by one unit (S14) | The next count corrects it | — |
| Two owner sessions overwrite each other (S23) | One owner | — |
| `config_snapshots` grows forever (insert-only): ~5 changes/day × 60 KB ≈ 110 MB/year | Within the mini PC's disk for years | Pruning deferred (§12.4) |
| `SNAPSHOT_SCHEMA_MIN_SERVED` raised while a hub still reads only the old version (S28 b) | 3 known hubs; the deploy checklist checks the access log first | That hub keeps its last config and shows "Hub update needed" (§8.2); no data is lost |
| A cloud restore without `rotate-config-epoch` (S29) | The CLI step is in the restore runbook (06) | Hubs keep the newer pre-restore menu until the cloud's version passes theirs; the owner sees the edits missing on the cloud pages |
| Business day uses the hub's OS time zone (S33) | Single-country pilot, no DST | Installation checklist sets `Asia/Karachi` |

### 7.7 Folder placement (F §6.9 + S20)
Hub: the poller goes in `src/sync/` (listed in F §6.9). The snapshot apply goes in `src/projections/branch-config.ts`, the availability projection in `src/projections/item-availability.ts`, commands in `src/commands/`, queries in `src/queries/`, the station validator in `src/sync/station-validator.ts`, `businessDayStartedAt` in `src/lib/business-day.ts` (S33), audiences and catch-up parts in `src/ws/restaurant-audiences.ts` and `src/ws/restaurant-catch-up.ts` (§4.5), pages in `src/pages/stock/` (S20). Cloud: `src/modules/restaurant/` (routes, service, repository, schemas), `src/modules/config-sync/`, `src/lib/idempotency.ts`, `src/lib/config-audit.ts`, `src/cli/rotate-config-epoch.ts` (S29, M56), `src/cli/set-branch-settings.ts` (§6.7), `src/pages/owner/`; snapshot builders per schema version in `src/modules/config-sync/builders/v1.ts` (S28). Shared: `packages/domain/src/hash.ts` (subpath export `@pos/domain/hash`, S27), `packages/events/src/config.ts`, `packages/events/src/events/stock/*.v1.ts`, `packages/events/src/events/hub/BranchConfigApplied.v1.ts`, `packages/engine/src/{state,apply-event,stock,version}.ts`.

---

## §8. Client contract

### 8.1 Cloud owner pages (`apps/cloud/src/pages/owner/`)
| Page | Purpose |
|---|---|
| `/owner/login.html` | Email + password → `/v1/auth/login`; JWT and refresh token in `sessionStorage` (cleared when the tab closes) |
| `/owner/index.html` | Branch picker (from JWT `allowed_branch_ids`; names from `GET /v1/admin/branches` — **not specified in 00**; the page uses the IDs from the floors/stations calls until 01b adds a branch list, open question Q3). Branch settings (`tax_enabled`, business day start) are not on 01a's pages; they are 01b's (§6.7) |
| `/owner/floors.html` | Floors with their tables; add, rename, reorder (sort number field, no drag), archive/restore; parking as a floor |
| `/owner/stations.html` | Stations and programs; slot/batch; capacity; freshness window; completion mode |
| `/owner/menu.html` | Tax classes, categories, items; the item's tax class picker has a **"No tax"** option (`tax_class_id: null`, S34) and it is selected by default; per-branch route picker filtered by station type; prices typed in rupees and converted to paisa by one function in `money.js` (`"1,200"` → `120000`; rejects fractions beyond 2 places); times typed in minutes, stored as `_ms`; **When pre-cooked stock runs out**: "Cook fresh" (default) / "Sold out" (`out_of_stock_behaviour`, S32) [ASSUMPTION] |

Rules: UI kit, `light` theme, `EN` string table per page module (keys `owner.*`, `errors.<CODE>`), one primary button per screen, busy button + 3 s slow banner. Each creating `POST` generates its `Idempotency-Key` when the form opens and keeps it across retries of that form. On `401 JWT_INVALID` the page refreshes once (`/v1/auth/refresh`), then goes to login. No offline mode: on a network failure the page shows a banner and keeps the form.

### 8.2 Hub page `/admin/stock` (`apps/hub/src/pages/stock/`)
- Opens on a paired tablet, kiosk or the owner's phone. If there is no admin session, it shows the admin roster and PIN pad (same endpoints as 00 §8.2; own module code, S20).
- Header: "Menu version 42 · checked 1 min ago" and a **Get changes now** button (§6.20). From `GET /admin/queries/config-status` (§6.21), read on open and every 15 s:
  - `last_problem` set → **danger banner** until it clears: `rejected` "Menu update refused (\<reason\>). The hub is still using version 42."; `upgrade_required` "Hub update needed: the cloud no longer sends this hub's menu format. The hub is still using version 42."; `unauthorized` "The hub's cloud key was refused. Call support."
  - `epoch_changed_at` within the last 24 h → **warn banner** "The menu was reset on the cloud at 14:20 (now version 40). Check prices and items."
- One row per item in config order: name, then for stock-tracked items **On hand** (number input, `inputmode="numeric"`), **Reserved**, **Available**, and "Set at 11:05", with a warn badge "Not counted today" when `set_at` is null or before `business_day_started_at` (S33, not midnight). A `sold_out` item shows "Sold out when 0" next to the count (S32). Every item has an **Available / Off** toggle (§6.18); an item that is off with `unavailable_since` before `business_day_started_at` shows the warn badge **"Off since \<Mon 24 Oct\>"** (S30).
- **Save counts** sends one `SetPrecookedStock` with the changed rows only; `command_id` generated per save and kept for retries (D32).
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
| `SNAPSHOT_SCHEMA_UNSUPPORTED` | 409 | `{ requested, min_supported, max_supported }` | `GET /v1/sync/config` with `snapshot_schema` below the cloud's `SNAPSHOT_SCHEMA_MIN_SERVED` (S28 b). A new code, not a reuse of 00's `426 CLIENT_UPGRADE_REQUIRED`, which is for `X-Client-Version` on hub routes |

A missing `Idempotency-Key` header is `400 VALIDATION_FAILED` with `issues[0].path = 'headers.idempotency-key'`.

---

## §10. Tests

Names cite `[01a §10 #n]`. Hub tests: temp SQLite + `inject()`; cloud tests: PostgreSQL 16 (F §6.7). Every cloud route is also covered by 00's route-inventory and cross-tenant tests (D54, M25).

### 10.1 Cloud — config delivery and idempotency

| # | Covers | Case |
|---|---|---|
| 1 | §6.1, S4 | Epoch and both versions equal → `304`, empty body, exactly 1 SQL statement (query counter) |
| 2 | §6.1 | `config_version` behind → `200`, `config.snapshot` parses with `BranchConfigSnapshotSchema`, `snapshot_hash` = sha256 of canonical JSON, `directory: null` |
| 3 | §6.1, S6 | `directory_version` behind only → `config: null`, directory equals `loadDirectory` output |
| 4 | §6.1 | Snapshot contains only active rows and only this branch's routes; archived station present with `is_archived: true`; an item with no route at this branch is absent |
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
| 15 | S21 | `GET /owner/menu.html` and cloud `/ui/tokens.css` need no JWT, carry the CSP header, and are on the allowlist; route-inventory passes |

### 10.2 Cloud — restaurant data

| # | Covers | Case |
|---|---|---|
| 16 | §6.2–6.3 | Create floor; list returns it with nested tables in 2 statements |
| 17 | §3.3 | Duplicate active floor name (case-insensitive) → `409 CONFIG_NAME_TAKEN`; same name allowed after archiving the first |
| 18 | §6.4, S22 | Archive floor with an active table → `409 CONFIG_IN_USE` listing the table |
| 19 | §6.4 | Unknown floor → `404 FLOOR_NOT_FOUND` |
| 20 | §6.5, S10 | Parking floor + table `P1` with `seats: null` → created; appears in the snapshot |
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
| 47 | S5 | Restart: boot loads the config from `branch_config` + `config_snapshots`; projection rebuild (reset + replay) gives the same row |
| 48 | S5 | Cloud-only restore: events present, `config_snapshots` empty → hub sends `config_version=0`, applies the full snapshot; state `BODY_MISSING` → `APPLIED` |
| 49 | S5 | UPDATE or DELETE on `config_snapshots` aborts (trigger) |
| 50 | S6 | Poll with config and directory → both applied in **one** transaction; forced failure → neither applied |
| 51 | S6, R14, M38 | Directory that removes a staff member who owns a paired phone → `DeviceRevoked { cause: 'owner_removed' }` and `SessionEnded 'staff_removed'` in the poll transaction |
| 52 | S6, M75 | Directory with a malformed hash for an existing staff member → their row kept, no revoke (01a calls 00 unchanged) |
| 53 | §3.4 | Network error / cloud `401` → outcome `offline` / `unauthorized`, nothing written, next tick retries |
| 54 | §3.4 | Two concurrent `pollOnce()` → one HTTP request; both callers get its result |
| 55 | §6.20 | `pull-now` → `200 applied`; cloud unreachable → `503 SERVICE_UNAVAILABLE`; without admin session → `401 ADMIN_SESSION_REQUIRED` |
| 56 | §6.21 | Config status shows last outcome and versions |
| 57 | §6.22, M31 | Before any config, `ApprovePairingRequest` for KDS → `404 STATION_NOT_FOUND`; after apply → paired; archived station → `404 STATION_NOT_FOUND` |
| 58 | §4.2 | `onBranchConfigApplied` hook runs inside the transaction with prev/next; an event it appends commits with `BranchConfigApplied` |

### 10.4 Hub — stock and availability

| # | Covers | Case |
|---|---|---|
| 59 | §6.17 | Morning entry of 3 items → 3 `StockSet` events, result shows `on_hand`, `reserved 0`, `available` |
| 60 | §6.17 | Unchanged `on_hand` entry → no event for it |
| 61 | §6.17 | Item not in config → `404 MENU_ITEM_NOT_FOUND`; not stock-tracked → `422 STOCK_NOT_TRACKED`; nothing written for any entry |
| 62 | §6.17 | Duplicate `item_id` in entries → `400 VALIDATION_FAILED`; 201 entries → `400` |
| 63 | §6.17 | Without `manage-stock` → `403 PERMISSION_DENIED`; Manager default role has it |
| 64 | §6.17, D32 | Retransmit same `command_id` → identical response, `Idempotent-Replay: true`, no new events |
| 65 | §6.17, D45 | Forced COMMIT failure → `EngineState.stock` unchanged |
| 66 | S14 | Engine unit: state `{ on_hand 5, reserved 2, set_at T0 }` + `StockSet 4` recorded at T1 → `{ 4, 2, T1 }`, available 2; `StockSet 1` → available 0 (never negative) |
| 67 | S15 | Restart → boot step 3 rebuilds stock from `StockSet` events; values equal pre-restart |
| 68 | S15, F §6.7 | `packages/engine/fixtures/engine-state.v1.json` equals `buildEngineState(fixture log)` |
| 69 | §6.18, S17 | Toggle off → `ItemMadeUnavailable`, projection row 0; toggle off again → no event, `changed: false`; on → `ItemMadeAvailable` |
| 70 | §6.18 | Retransmit → replay; unknown item → `404`; no `manage-stock` → `403` |
| 71 | §4.2 | `itemAvailability(db, ids)` = 1 statement for 1 and 100 ids; missing row = available |
| 72 | §6.19 | Stock query: 1 statement (query counter); `set_at` from `EngineState.stock`, equal to the latest `StockSet`'s `recorded_at`; no config → `items: []`, 0 statements |
| 73 | §4.5 | `StockSet` and `ItemMade*` are pushed to staff sockets, not to station sockets; `BranchConfigApplied` is pushed to both |

### 10.5 Pages (S20)

| # | Covers | Case |
|---|---|---|
| 74 | §8.1 | `money.js`: `"1,200"` → 120000, `"1200.5"` → 120050, `"1.234"` / `"-1"` / `"abc"` → rejected |
| 75 | §8.1 | Menu page: an item name containing `<img onerror>` is rendered as text (`textContent`), never as HTML |
| 76 | §8.1 | Form retry reuses its `Idempotency-Key`; a new form gets a new one |
| 77 | §8.2 | Stock page saves only changed rows, reuses `command_id` on retry, shows "Not counted today" for a `set_at` before `business_day_started_at` (S33) |
| 78 | §7.1 | Static helper serves listed `.html`/`.js` only; `../`, `.ts` and unlisted paths → `404 ROUTE_NOT_FOUND` |
| 79 | S20 | Lint: page `.js` imports only relative paths (ESLint `no-restricted-imports`) |

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
| 89 | S14, E1 stock AC6 | A new stock-tracked item with no `StockSet` → stock query shows `on_hand 0, reserved 0, available 0, set_at null`; `availableStock` = 0; catch-up `stock` part has it at 0 |
| 90 | §4.5, E0 availability AC1 | Under `vi.useFakeTimers()`, a connected staff socket receives the `event` frame for `ItemMadeUnavailable` from `SetItemAvailability` with the clock advanced by less than 5 000 ms (the frame is sent after COMMIT with no timer in between); a socket that reconnects afterwards gets the item in `catch_up.state.availability.unavailable_item_ids` |
| 91 | §4.5 | Catch-up: a staff socket gets `branch_config`, `availability` and `stock`; a station socket gets `branch_config` only; before any config, `branch_config` is null |
| 92 | §6.23 | `GET /queries/branch-config` from a staff and a station session → current snapshot, hash and version, 0 statements; before the first apply → `data: null`; no session → `401` from 00's session guard |
| 93 | S14, S15 | Restart after `StockSet` → `set_at` equals its value before the restart (the fold reads `recorded_at`, not the clock) |

### 10.5b Added in v0.3

| # | Covers | Case |
|---|---|---|
| 94 | S28 c, d | **Unknown field accepted:** a cloud snapshot (hashed by the cloud) with an extra `items[0].spice_level: 2` and a top-level `"promo": {}` → the hub applies it; the hash verifies over the raw JSON; `branchConfig()` has neither field; `config_snapshots.body` keeps both, and `sha256hex(body)` equals `snapshot_hash`; restart parses the stored body to the same `branchConfig()` |
| 95 | S28 d | **Hash before parse:** a snapshot whose raw hash does not match, but whose Zod-stripped form would match, is rejected (`hash_mismatch`), proving the hash is taken before Zod |
| 96 | S28 b, §6.1 | **Cloud serves the requested schema:** with a test-only v2 builder registered (cloud max 2, min served 1): `snapshot_schema=1` → `snapshot_schema_version: 1` with only v1 fields, and its hash verifies; `snapshot_schema=3` → version 2; min served raised to 2 and `snapshot_schema=1` → `409 SNAPSHOT_SCHEMA_UNSUPPORTED { requested: 1, min_supported: 2, max_supported: 2 }`, 0 SQL statements |
| 97 | S28 b, S29 c | **Hub on schema 1, cloud on schema 2:** end to end (hub `SNAPSHOT_SCHEMA_MAX = 1`, cloud max 2) the hub gets and applies a schema 1 snapshot. When the cloud answers `409`, the hub keeps its config and config status shows `last_problem.outcome = 'upgrade_required'`. The next applied poll clears it |
| 98 | S28 e | Upgraded hub: `branch_config.snapshot_schema_version = 1` and hub max 2 → the poll sends `config_version=0` and applies the schema 2 snapshot even though `config_version` is unchanged |
| 99 | S29 b, §6.1 | Epoch differs with versions equal → `200` with config; epoch and versions equal → `304` (test 1) |
| 100 | S29 b | **Regression after restore:** hub at v50, epoch A; cloud restored to v40, then `rotate-config-epoch` → epoch B → the hub applies v40, outcome `epoch_changed`, `BranchConfigApplied { previous_config_epoch: A, previous_config_version: 50 }`, `epoch_changed_at` set. Without the rotation (epoch A, v40 < 50) the config part is ignored |
| 101 | S29 a | `rotate-config-epoch --branch <id>` sets a new ULID on that branch only and does not bump `config_version`; it runs only through `SystemContext` (M56 lint test). A branch created by `seed-tenant` or `/hubs/register` has a non-empty epoch from the column default; the migration gives each existing branch a distinct epoch |
| 102 | S29 c, §6.21, §8.2 | Visibility: after a hash-mismatch poll, config status returns `last_problem { rejected, hash_mismatch, at }`; it clears after the next `applied` or `unchanged`. Stock page (page test): the danger banner shows for `rejected`, `upgrade_required` and `unauthorized`; the warn banner shows when `epoch_changed_at` is within 24 h and not after |
| 103 | S30, §6.19 | Item turned off yesterday at 22:00, business day started today at 05:00 → stock query `unavailable_since` = yesterday 22:00 and the page shows "Off since \<day\>". Turned off today at 06:00 → no badge. Available item → `unavailable_since: null` |
| 104 | S33 | `businessDayStartedAt`: start 05:00, now 02:00 → yesterday 05:00; now 05:00 exactly → today 05:00; start 00:00 → local midnight. "Not counted today": `set_at` yesterday 23:00 at now 02:00 → no badge; at now 06:00 → badge |
| 105 | §6.7, S33, S34, S26 | CLI `set-branch-settings --business-day-start 06:00 --tax-enabled true` → row updated, one audit row `branch_settings` / `update` with `actor_kind 'cli'`, `before` / `after`, this branch bumped only, both values in the next snapshot. `--business-day-start 24:00` or `05:30:15` → refused, nothing written |
| 106 | S32, §6.14 | Item created without `out_of_stock_behaviour` → `cook_fresh`; PATCH to `sold_out` → in the snapshot and audited; `"never"` → `400`; `sold_out` on an item with no stock tracking at a branch → accepted (ignored there) |
| 107 | S34, §6.14, §3.3 | Item created with `tax_class_id: null` → `201`; it appears in the snapshot with `"tax_class_id": null`. A tax class archived while only null-tax items exist → allowed. `tax_class_id` of an archived class → `422 CONFIG_REFERENCE_INVALID`. PATCH from a class to null → audited, in the next snapshot |
| 108 | S34 | A new branch (`seed-tenant`) has `tax_enabled: false` in its snapshot; after `set-branch-settings --tax-enabled true` the next snapshot has `true`; the snapshot schema rejects a missing `tax_enabled` |

### 10.6 Acceptance table

| Story AC | Test |
|---|---|
| E1 floors AC1 (floors; canvas narrowed S9) | 16, 17 |
| E1 floors AC2 (tables; shape/position narrowed S9) | 20, 21 |
| E1 floors AC3 slot/batch, capacity, programs (floor position narrowed S10) | 24, 28 |
| E1 floors AC4 freshness window default 0 | 24 |
| E1 floors AC5 rename, archive, history preserved | 17, 18, 25, 38 |
| E1 floors AC6 archived station with in-progress tickets (snapshot keeps it) | 4, 57 (data part); the warning is **deferred to 03b** (§4.4, §12.4): the cloud cannot see tickets |
| E1 edge: station removed while orders are in flight → warn admin | **Deferred to 03b** (§4.4) |
| E1 edge: same station name on two floors | **Overridden** by S10 (unique per branch; `location_label` says where); 17 pattern |
| E1 route AC1 station, prep, cook time, serve mode | 33 |
| E1 route AC2 stock time | 33, 35 |
| E1 route AC4 batch program + stock program | 34, 29 |
| E1 route AC5 integer paisa | 33, 74 |
| E1 route edge: unconfigured station → validation error | 34 |
| E1 route edge: stock time 0 valid | 35 |
| E1 stock AC1 count at start, update any time | 59, 60 |
| E1 stock AC2 manager view of countdown | 72, 77 |
| E1 stock AC6 no count → 0 (full cook time) | 89 |
| E0 menu AC1 categories, archive | 32, 38 |
| E0 menu AC2 fields (image deferred S13) | 33 |
| E0 menu AC3 stock time | 33, 35 |
| E0 menu edge: zero-price item valid | 88 |
| E0 menu AC7 archived items gone from ordering, kept in history | 38 |
| E0 menu AC8 tax class on every item | **Overridden** by S34 (tax class optional; branch `tax_enabled`): 31, 33, 107, 108 |
| E0 availability AC1 toggle, reflected on ordering screens within 5 s | 69, 73, 90, 91 |
| E0 PIN AC1 duplicate PINs rejected | **Dropped** by 00 M27 (duplicates allowed; salted hashes make detection impossible). No 01a or 01b test |
| Owner config changes are traceable (T2 audit, "who changed a price") | 80–84, 105 (CLI) |
| A cloud deploy that adds a snapshot field never freezes hubs (S28) | 94–98 |
| A cloud restore never leaves hubs on a menu the cloud no longer has, and problems are visible (S29) | 99–102 |
| E1 stock AC1 "start of service" / "Not counted today" uses the business day [ASSUMPTION] (S33) | 104 |
| Availability carried over between days is visible (S30) | 103 |
| [ASSUMPTION] Sold-out vs cook-fresh at stock 0 (S32): stored and delivered here; behaviour in 02 / 03a | 106 |
| Tax rate resolved at bill close; tax only when `tax_enabled` and a tax class (S31, S34) | Carried to 05. 01a delivers the data: 107, 108 |
| Carried: `registerStationValidator` | 57 |
| Carried: cloud `idempotency_keys` (M69) | 9–14 |
| Carried: BYOD auto-revoke on staff exit (R14) | 51 |
| Carried: staff/role admin, PIN, `directory_version` bump; owner lockout notice | 01b, reserved tests 01b #1–#3 and #4 (§12.5) |
| Carried: E6 roles AC5 (role assignments and permission changes in the audit log) | 01b, reserved test 01b #5 (§12.5) |

---

## §11. Build order

Each task is TDD (failing test first) and is one commit citing its sections.

1. Spec 00 v1.2.1 editorial patch (docs only, S25) [§2, S25]
2. `@pos/domain`: append §9 codes to `errors.ts` and F §6.2; add `manage-stock` to `permissions.ts`; grant it to Owner and Manager in `default-roles.ts` [§9, S18]
3. `@pos/domain/hash`: move `canonicalJson`, `sha256hex` to `packages/domain/src/hash.ts` (subpath export in `package.json`); hub `lib/hash.ts` re-exports them; existing hub hash tests still pass [S27]
4. `@pos/events`: `config.ts` (`SNAPSHOT_SCHEMA_MAX = 1`, `BranchConfigSnapshotSchemaV1`, not `.strict()`, S28), `BranchConfigApplied.v1`, `StockSet.v1`, `ItemMadeUnavailable.v1`, `ItemMadeAvailable.v1`, fixtures and builders [§4.2, §4.3]
5. `packages/engine` (new package, F §6.9 folder): `state.ts`, `stock.ts`, `apply-event.ts`, `version.ts`, fixture `engine-state.v1.json`; tests 66, 68 [S14, S15]
6. Cloud migration `0002_restaurant_setup.sql`, including `config_audit` and its trigger, `branches.config_epoch` and `business_day_start_ms`, `tax_enabled`, `menu_items.out_of_stock_behaviour`, nullable `tax_class_id`, `config_audit.actor_kind`; test 84 [§5.2, S26, S29, S32, S33, S34]
7. Cloud `lib/idempotency.ts` (`withIdempotency`), tests 9–14 [S7]
8. Cloud `bumpConfigVersion` (S8 lock order) and `lib/config-audit.ts` (`writeConfigAudit`); tests 7, 8 [S8, S26]
9. Cloud `modules/restaurant`: floors and tables §6.2–6.6, with audit rows; tests 16–23, 80, 83 [§6 batch 1, §6.0]
10. Cloud stations and programs §6.8–6.10; tests 24–30, 86 [§6 batch 2]
11. Cloud tax classes, categories §6.12–6.13; tests 31, 32 [§6 batch 3]
12. Cloud menu items and routes §6.11, 6.14–6.16; tests 33–41, 81, 82, 87, 88, 106, 107 [§6 batch 3, S32, S34]
13. Cloud `modules/config-sync`: `GET /v1/sync/config` with `builders/v1.ts`, schema negotiation and the epoch check; tests 1–6, 85, 96, 99 [§6.1, S4, S27, S28, S29]
14. Cloud CLIs `cli/rotate-config-epoch.ts` and `cli/set-branch-settings.ts`; tests 101, 105, 108 [S29 a, §6.7, S33, S34, M56]
15. Hub migration `0004_restaurant_config.sql`; projections `branch-config.ts`, `item-availability.ts`; test 49 [§5.1]
16. Hub `sync/config-poller.ts` (`pollOnce`, apply, swap, `onBranchConfigApplied`), boot step 6 timer; `QueryCtx.state` / `.config`; raw-JSON hash before parse, epoch rule, `last_problem`; tests 42–47, 50, 53, 54, 58, 94, 95, 97, 98, 100 [§3.4, S5, S6, S16, S28, S29]
17. Hub cloud-only-restore path (`BODY_MISSING`); directory-through-poll tests 48, 51, 52 [S5, S6]
18. Hub `sync/station-validator.ts`; test 57 [§6.22]
19. Hub reducer `state.setReducer(applyEvent)` and `initialEngineState()` at `lib/boot.ts:278–279`, boot step 3 stock fold; tests 67, 93 [S15]
20. Hub `SetPrecookedStock`; tests 59–65 [§6.17]
21. Hub `SetItemAvailability`, `itemAvailability`; tests 69–71 [§6.18]
22. Hub `lib/business-day.ts`; queries stock and config status, `pull-now`; tests 55, 56, 72, 89, 102 (status part), 103, 104 [§6.19–6.21, S29 c, S30, S33]
23. Hub WS audiences and catch-up parts, `GET /queries/branch-config`; tests 73, 90, 91, 92 [§4.5, §6.23]
24. Static page helper (hub + cloud), cloud `/ui/*` and `/owner/*` allowlist + CSP; tests 15, 78, 79 [§7.1, S20, S21]
25. Cloud owner pages: login, floors, stations, menu, `money.js`; tests 74–76 [§8.1]
26. Hub `/admin/stock` page with problem and epoch banners, "Off since"; tests 77, 102 (page part) [§8.2]
27. Manual runbook: owner creates a branch menu; hub pulls it; KDS pairs to a station; manager sets stock offline (internet unplugged); cloud restore drill: restore an older cloud dump, run `rotate-config-epoch`, and see the hub apply the older menu and show the epoch banner [§10.6, S29]

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done
- Every numbered test 1–108 has exactly one test citing it; all pass in CI (hub SQLite, cloud PostgreSQL 16).
- Route-inventory and cross-tenant tests pass with the new routes and the `config_audit` table (D54).
- Every owner config write in §6.0 writes its `config_audit` row in the same transaction (tests 80–84).
- Spec 00 v1.2.1 editorial patch applied (S25).
- §9 codes are in `errors.ts` and F §6.2; `manage-stock` is in the catalogue and the default roles.
- README updated: module map (01a, 01b), milestones (01b before the first live order), requirements carried (§4.4), 00 drift notes (§2).
- Runbook (task 27) done on the dev box: a cloud menu edit reaches the hub within 60 s; a KDS pairs to a station; stock entry works with the internet down; the restore drill shows the epoch banner.
- The cloud restore runbook (06 / ops) includes `rotate-config-epoch` (S29).
- No new runtime dependency.

### 12.2 Endpoint checklist

| # | Route / command | Auth | Permission | Idempotency | Tests |
|---|---|---|---|---|---|
| 6.1 | `GET /v1/sync/config` | branch key | — | read | 1–6, 85, 96, 99 |
| 6.2 | `GET /v1/admin/branches/:b/floors` | JWT | owner | read | 16 |
| 6.3 | `POST …/floors` | JWT | owner | key | 16, 17, 80, 83 |
| 6.4 | `PATCH …/floors/:id` | JWT | owner | PATCH | 17–19 |
| 6.5 | `POST …/tables` | JWT | owner | key | 20, 21 |
| 6.6 | `PATCH …/tables/:id` | JWT | owner | PATCH | 22 |
| 6.8 | `GET …/stations` | JWT | owner | read | 24 |
| 6.9 | `POST` / `PATCH …/stations` | JWT | owner | key / PATCH | 24–27, 82, 86 |
| 6.10 | `POST` / `PATCH …/programs` | JWT | owner | key / PATCH | 28–30, 87 |
| 6.11 | `GET /v1/admin/menu` | JWT | owner | read | 40 |
| 6.12 | tax classes `POST` / `PATCH` | JWT | owner | key / PATCH | 31 |
| 6.13 | categories `POST` / `PATCH` | JWT | owner | key / PATCH | 32, 82 |
| 6.14 | `POST /v1/admin/menu-items` | JWT | owner | key | 33–37, 41, 87, 88, 106, 107 |
| 6.15 | `PATCH /v1/admin/menu-items/:id` | JWT | owner | PATCH | 38, 81 |
| 6.16 | `PUT …/routes/:branch_id` | JWT | owner | PUT | 39, 82, 86 |
| 6.17 | `SetPrecookedStock` | admin session | `manage-stock` | `command_id` | 59–65 |
| 6.18 | `SetItemAvailability` | admin session | `manage-stock` | `command_id` | 69, 70, 90 |
| 6.19 | `GET /admin/queries/stock` | admin session | `manage-stock` | read | 72, 89, 103, 104 |
| 6.20 | `POST /admin/config/pull-now` | admin session | `access-hub-admin` | repeat-safe | 55 |
| 6.21 | `GET /admin/queries/config-status` | admin session | `access-hub-admin` | read | 56, 97, 102 |
| 6.23 | `GET /queries/branch-config` | staff or station session | — (any session) | read | 92 |

### 12.3 Open questions (developer)
| # | Question | Blocks |
|---|---|---|
| Q1 | A head cook who enters stock needs `access-hub-admin` to open `/admin/stock` (S18). Is that acceptable, or should 02's client get a staff-session stock screen? | Nothing in 01a; decide with 01b roles |
| Q2 | **Resolved in v0.2 (S25).** Behaviour is identical, so spec 00 is patched editorially to v1.2.1 to match the code (exact lines in S25). `QueryCtx.state` / `.config` stay 01a's own additive change (S16). | — |
| Q3 | The owner pages need branch names; 00 has no `GET /v1/admin/branches`. Add it in 01b (staff-to-branch assignment needs it too)? Until then, pages show branch IDs from the JWT. | §8.1 polish only |
| Q4 | The staff directory has the same regression as config (S29): after a cloud restore, `tenants.directory_version` goes back and hubs ignore it (00 M51 forward-only), so a staff member removed after the backup could keep working. Add a `directory_epoch` the same way in 01b, or have `rotate-config-epoch` also force a full directory resend? | 01b; the restore runbook (06) |

### 12.4 Deferred until needed
| Item | Trigger |
|---|---|
| Floor canvas, table shape, `pos_x` / `pos_y` (S9) | Owner asks for a visual map after the pilot |
| Item images (S13) | Owner asks for photos on screens or a customer menu (P2 E9) |
| Optimistic concurrency on owner PATCH (S23) | More than one person edits the menu |
| `config_snapshots` pruning | Hub disk use from snapshots > 1 GB, or 03a's checkpoint makes old bodies unreachable |
| Shared static helper between hub and cloud | The two copies differ in a bug fix |
| Per-branch prices (E0 P2 price lists) | Owner answer to question 5 |
| Bulk table create | More than one new branch to set up |
| Warn about in-flight tickets when a station is archived (E1 floors AC6, edge case) | **Owned by 03b** (§4.4): the hub sees tickets, the cloud does not. Built with 03b's KDS through `onBranchConfigApplied` |
| Read endpoint and owner page for `config_audit` (S26) | Owner asks "who changed this price"; until then it is answered with a SQL query on the cloud database |

### 12.5 01b scope list (not written in this draft)
Required for milestone A, before the first live order (S2); built alongside 02.
- Cloud roles from the permission catalogue (list, create, edit, archive); E6 AC1, 2, 5 (audit of role changes), 7 (last `access-hub-admin` guard, 00 M57; owner cannot remove their own admin access).
- Staff CRUD, staff-to-branch assignment (`staff_branches`), `is_active` for exit (exit → removed from the directory → 01a's poll ends sessions and revokes the BYOD phone, 01a test 51).
- PIN set/reset: 4–6 digits sent over HTTPS, hashed with argon2id **on the cloud** at 00 M8 parameters or stronger, never a hash the hub would skip under M52. This overrides D40 / F §3.1 "hashed on the setting device" and must be recorded in 01b as a named decision. PIN reset ends sessions through M50.
- `tenants.directory_version` bump on every staff/role change (00 M51), strictly upward.
- Out-of-band owner lockout notice (00 M73): dashboard notice on the next successful login, plus e-mail if a sender exists.
- `GET /v1/admin/branches` (Q3) and **`PATCH /v1/admin/branches/:branch_id/settings { tax_enabled?, business_day_start_ms? }`**: owner-only, common write script, `config_audit` row `branch_settings` / `update` (`actor_kind 'owner'`), bump that branch (01a §6.7, S33, S34), plus a branch settings page. Staff/role owner pages (S20 pattern); `withIdempotency` on creates.
- Possibly, after the owner visit: modifiers/add-ons/combos (S12) and scheduled availability (E0 availability AC4–5) — or a separate 01c if 01b would exceed the size budget.
- **Reserved 01b test numbers for carried items:** 01b #1 role CRUD from the catalogue + last-admin guard; 01b #2 staff CRUD + branch assignment + `directory_version` bump; 01b #3 PIN set/reset produces an M8-valid argon2id hash that 00's `applyStaffDirectory` accepts (not skipped under M52) and ends sessions (M50); 01b #4 locked owner account → notice shown on the next successful login (M73); 01b #5 E6 roles AC5: every role create/edit/archive, permission change and role assignment writes one audit row in the same transaction, with actor, before and after.
- Not in 01b: E0 PIN AC1 (duplicate PINs rejected) is dropped by 00 M27. Duplicates are allowed, because salted hashes make detection impossible.

### 12.6 Owner questions for the visit
Each question names the decisions that wait on its answer.
1. Do you serve customers in cars (parking)? Roughly how many spots, and are they numbered? (S10)
2. Which extras do customers ask for most (extra naan, extra nalli, less spicy…)? Are they paid or free? (S12)
3. How is pre-cooked stock counted: plates, pieces, or kg per pot? When the paye or another pre-cooked pot runs out, is the item sold out for the day, or do you cook more? Which items are which? (S14, S32)
4. Is leftover pre-cooked food sold the next morning, or thrown away at closing? If an item is switched off at night, should it be back on automatically in the morning? (S30, §4.4 05)
5. Is the menu and every price the same at all three branches? Is any item sold at only one branch? (S11)
6. How many menu items do you have, how many come in half/full or sizes, and do you sell deals or combos today? (S12, §6.11)
7. Do you charge tax at all today? At every branch? On cash and card both? If yes: what rate(s), do your menu prices already include tax, and do you issue PRA receipts today (OQ15)? (S31, S34, §4.4 05)
8. Who counts the pre-cooked stock in the morning: the manager or the head cook? (S18, Q1)
9. Do some items run only part of the day or week (breakfast, Friday specials)? (scheduled availability, 01b)
10. In the kitchen, which items are cooked several at once in one load (fryer, tandoor), and how long does each load take? (station and program data)
11. What time does the restaurant open and close? Does the day run past midnight? (S33)
