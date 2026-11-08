# 01a — Restaurant Setup (restaurant data + config delivery) — Module Spec v2.3 (APPROVED)

**v2.3 — APPROVED 2026-11-07 (developer as the owner's proxy), with 02b Ordering v1.0 (breaking before the pilot, R29).** Change driven by 02b v1.0 §4.5 row A-1 (`docs/specs/02b_Ordering_Spec_v1.0.md`): per-zone item routes and zone stock items (nested on the zone route), the item flag `is_ready_item`, four branch settings and the comp reason chips, `StockTransferredOut` in the stock lists. **Ships in the same release as snapshot V4** (V4 unbuilt, R29): no new snapshot version. Not yet built: **built in 02p** (02p §11 tasks 3–6, 9, 17). *(02p task 0, m-8: was "Not yet built.")*

### Changes in v2.3 (02b Ordering v1.0 §4.5 row A-1; developer as the owner's proxy, 2026-11-07)

| Row (02b) | Change | Where |
|---|---|---|
| A-1 | Tables `zone_item_routes (zone_id, item_id, station_id)` and `zone_stock_items (zone_id, item_id, threshold)`, written as **nested replace-lists** `routes[]` / `stock_items[]` on the zone routes (§6.6a, §6.6b); a zone stock item must be `sale_unit 'piece'` and not `requires_weighing` (`422 CONFIG_REFERENCE_INVALID { field: 'stock_items.N.item_id' }`) | §5.2, §6.6a, §6.6b |
| — | Snapshot V4 gains `floors[].zones[].routes[]`, `floors[].zones[].stock_items[]` and `items[].is_ready_item` (same release as V4, no new version) | §4.3 |
| — | `menu_items.is_ready_item BOOLEAN NOT NULL DEFAULT false` (owner, 02b Q5: a ready item — bottled water, a soft drink — never turns a table green); owner app item form checkbox "Ready item (not cooked)" | §5.2, §6 menu items, §8.1 |
| — | `branch_engine_settings` gains `queue_auto_send_max_ms` (14 400 000; 00 v1.8 M95 cap), `zone_undo_ms` (300 000), `slow_item_threshold_ms` (900 000, E2-SOLD AC2), `served_estimate_ms` (null until 03b) and `comp_reason_chips` (text list, default "Late", "Wrong item", "Quality", "Guest", "Other") | A-12 settings |
| — | `StockTransferredOut` (03a v1.2 Q-5) added to `STOCK_VERSION_EVENTS` (`sync/stock-version.ts`), the stock-frame audience (`ws/restaurant-audiences.ts`) and the boot fold lists | §6.19 |
| — | Tests 189–195 | §10.5j |
| — | *As built, 02p task 3 (owner rulings 2026-11-08, AD-4–AD-7; text only, no bump):* table restore clears a stale archived zone; a zone restore onto an archived floor is refused; archiving an item or station named by an active zone list, or making a zone stock item weighed / not piece, → `409 CONFIG_IN_USE` (`used_by` zone); three new `CONFIG_REFERENCE_INVALID` reasons | §6.6, §6.6b, §6.9, §6.15, §9 |


**v2.2 — APPROVED 2026-11-07 (developer as the owner's proxy), with 02a Tables v1.0 (breaking before the pilot, R29).** Change driven by 02a v1.0 §4.5 row A-1 (`docs/specs/02a_Tables_Spec_v1.0.md`): **zones** inside a floor, `dining_tables.zone_id`, two admin routes, snapshot schema 4. **Ships in the same release as 03a's snapshot schema 3, before the pilot; fixtures move V3 → V4 once.** Not yet built: **built in 02p** (02p §11 tasks 3, 4, 6). *(02p task 0, m-8: was "built with 02a".)* Markers "⚠️ Changed by 02a v1.0 (A-1)".

**v2.1 — APPROVED 2026-11-03 (developer as the owner's proxy), with 03a Timing Engine v1.0 (breaking before the pilot, R29).** Changes driven by 03a v1.0 §4.5 "01a v2.0.1 → v2.1", rows A-1–A-20 (`docs/specs/03a_Timing_Engine_Spec_v1.0.md`): the engine configuration (points, station timing fields, alternates, carry times, item knobs, branch engine settings, goes-with links; cloud migration `0007_engine_config.sql`), two points routes (28 → 30 endpoints), snapshot schema 3, the stock commands appending 03a's `stockEffects` drafts, `StockAdded.reason`, `stock_version` with the three new stock events, boot step 3 replaced by 03a, and A-20 (a mismatched-unit `StockAdded` no longer throws). Each place carries a "⚠️ Changed by 03a v1.0 (A-n)" marker; the changelog is "Changes in v2.1" below. **Built by the 03a build** (03a §11; merged to main in `3f78a44`). *(02p task 0, m-8: was "Not yet built: the 03a build implements it … stays the implemented baseline until then".)* v2.0.1 kept as history.

### Changes in v2.2 (02a Tables v1.0 §4.5 row A-1; developer as the owner's proxy, 2026-11-07)

| Row (02a) | Change | Where |
|---|---|---|
| A-1 | New table `zones` (a floor has 0..n zones; owner Q1 / Q5, 02-g0 §5.4); nullable `dining_tables.zone_id` (same floor); routes `POST …/zones`, `PATCH …/zones/:zone_id`; floors list returns zones; tables accept `zone_id`; floor archive refused while it has active zones | §5.2, §6.2–§6.6, §6.6a, §6.6b |
| — | Snapshot schema 4 (`SNAPSHOT_SCHEMA_VERSION = 4`), breaking: `floors[].zones[]`, `tables[].zone_id`; **same release as V3** (R29) | §4.2, §4.3 |
| — | `ZONE_NOT_FOUND` (404) | §9 |
| — | Sync poll +1 statement (zones) | §6.1 |
| — | Tests 181–188 | §10.5i, §12.2 |


### Changes in v2.1 (03a Timing Engine v1.0 §4.5; developer as the owner's proxy, 2026-11-03)

| Row (03a) | Change | Where |
|---|---|---|
| A-1 | New table `points` (Pass created per branch by the migration) | §5.2, §6.8, §6.9a |
| A-2–A-8 | `stations` gain `point_id`, `policy`, `freeze_ms`, `min_slack_keep_ms`, `promise_padding_ms`, the pressure fields, `pause_enabled`, `lane_units`, `reserve_units` | §5.2, §6.9 |
| A-9, A-10 | New tables `station_alternates`, `carry_times` (nested replace-lists on the station routes) | §5.2, §6.9 |
| A-11 | `menu_items` gain `weight_pct`, `max_early_ms`, `max_carry_ms`, `max_late_ms`, `adjust_time_ms` | §5.2, §6.15 |
| A-12 | New table `branch_engine_settings`, read and written through 01b's branch settings endpoint (01b v1.5 B-6) | §5.2 |
| A-13 | New table `goes_with_links` (category and item `PATCH`) | §5.2, §6.13, §6.15 |
| A-14 | The stock commands and `CloseBusinessDay` append 03a's `stockEffects` drafts | §6.17, §6.17a, §6.18b |
| A-15 | Boot step 3 fold replaced by 03a's full replay | S15 |
| A-16 | `ENGINE_STATE_VERSION = 3`; `EngineState` gains 03a's slices | §4.2 |
| A-17 | `STOCK_VERSION_EVENTS` gains `StockReserved`, `StockReleased`, `StockConsumed`; boot reads the version with 2 statements | §6.19 |
| A-18 | "The hand-over step" = `StockConsumed` at `ItemStarted` | §4.4 To 03a |
| A-19 | `StockAdded` v2 gains optional `reason?: 'moved'` | §4.2 events, S45 |
| A-20 | A `StockAdded` whose `unit` differs from the entry's no longer throws: the entry is unchanged and a breach is reported; no stock fold throws; test 129 re-baselined (03a BF-13) | S14, §10 test 129 |
| — | Snapshot schema 3 (`SNAPSHOT_SCHEMA_VERSION = 3`), breaking: cloud and every hub released together | §4.2, §4.3 |
| — | Endpoints: `POST` / `PATCH …/points` (28 → 30) | §6.9a, §6.24, §12.2 |

**v2.0.1 — APPROVED 2026-11-02 (developer): as-built patch from 01d v1.1** (`docs/specs/01d_Notifications_Requests_Spec_v1.1.md` §1 "Contract changes other modules read", §4.3 To 01a; AD-123; patch-level so v2.1 stays free for 03a): §6.21 `GET /admin/queries/config-status` gains `stuck_alerts` (required int) and goes from 2 to 3 statements; §8.2 the `/admin/stock` More menu shows "Stuck alerts: N" while N > 0. Each place carries a "Changed by 01d v1.1" marker. No endpoint, error code, event or migration change.

**v2.0 — APPROVED 2026-10-29, with 01c Menu v1.0 (breaking, 01c V1).** Changes driven by 01c v1.0 as listed in 01c §4.5 rows A1–A18: §1 out of scope (A1); §3.1 S12, S14, S28, S41, S44, S45, S46, S59 and new S61 recording the package (A1–A3, A17); §3.3 (A4, A17); §4.2 (A5); §4.3 (A3, A17); §4.4 01c, 02 and 03a rows (A6); §4.5 (A7); §5.1 (A8, no change); §5.2 (A9, A17); §6.1, §6.23 (A12); §6.9, §6.12, §6.13 (A10); §6.11, §6.14 (A11, A17); §6.15 (A10, A11, A17, A18); §6.17, §6.17a, §6.18a, §6.19 (A13); §8.1, §8.2 (A14); §9 (A15); §10 (A16, 34 tests). Each changed section carries a "Changed by 01c v1.0" marker; **where a marker and the text under it differ, the marker and 01c v1.0 win**. No 01a code changes with this bump; the 01c build implements it. Snapshot schema 2 and the v2 stock events ship to the cloud and every hub together (01c V1, S28 b).

**v1.3.1 — APPROVED 2026-10-28 (human amendment, client only).** S50 a: at phone width the owner shell has a **Menu** button that opens the side menu as an overlay on the kit `Dialog`, instead of the v1.1 bottom tab bar (01b task T50b, parked question P-4, answer B, `docs/reviews/01b-parked.md`); test 180. No endpoint, contract, error code, event or migration change.

**v1.3 (2026-10-27).** Changes driven by 01b Staff & Roles v1.0 (v0.3, then hostile review 1, `docs/reviews/01b_spec_review_1.md`): §3.1 (S8, S26, new S60), §4.4 (01b row), §5.2, §6 (shared failures), §6.0, §6.1, §6.7, §6.7b, §6.17, §6.17a, §6.18, §6.18a, §6.18b, §6.19, §8.2, §12.5; §3.4 (poll interval constant, 01b D-11); §7.8 (roll-forward-only release step, 01b review 2 N5). See 01b §4.4.

## §1. Header

| Field | Value |
|-------|-------|
| Module | 01a Restaurant Setup: restaurant data and config delivery. 01b (staff and role admin) is a separate spec; its scope is listed in §12.5 |
| Version | **v2.2 — APPROVED** 2026-11-07 (developer as the owner's proxy) with 02a Tables v1.0 (02a §4.5 A-1: zones, snapshot schema 4, same release as schema 3; R29); not yet built: built in 02p *(02p task 0, m-8)*. **v2.1 — APPROVED** 2026-11-03 (developer as the owner's proxy) with 03a Timing Engine v1.0 (03a §4.5 A-1–A-20; breaking, snapshot schema 3, R29); **built by the 03a build** (`3f78a44`; 02p task 0, m-8: was "not yet built: the 03a build implements it"); v2.0.1 kept as history. **v2.0.1 — APPROVED** 2026-11-02 (developer): as-built patch from 01d v1.1 (AD-123, `stuck_alerts` in §6.21; "Changed by 01d v1.1" markers); implemented by the 01d build; v2.0 kept as history. **v2.0 — APPROVED** 2026-10-29 with 01c Menu v1.0 (breaking, 01c V1; 01c §4.5 A1–A18, S61; review `docs/reviews/01c_hostile_G4.md` run 5). **v1.3.1 — APPROVED** 2026-10-28 (human amendment, client only; promised in the P-4 answer): S50 a phone shell is a Menu button and an overlay side menu on the kit `Dialog`, not a bottom tab bar (P-4 answer B); test 180. Client only, no other change. **v1.3 — APPROVED** by the owner (2026-10-27), together with 01b v1.0 and 00 v1.5: changes driven by 01b Staff & Roles v1.0 (S60, 01b §4.4; hostile reviews 1 and 2 of the 01b package applied). **Supersedes v1.2**; implemented by the 01b build (2026-10-28). v1.2 — **APPROVED** by the owner (2026-10-26, owner "go" on the design hand-off's Phase 2b and on branch names; no hostile review). **v1.2 over v1.1: per-branch price, branch names, kg/L line rounding.** Per-branch price on the route, `item_routes.price_minor_override` (cloud migration `0004_branch_price.sql`), the snapshot carries the branch's effective price, the item form's **Price here** and the menu chip (S57, owner answer Q6.5; the S11 "same prices" assumption is gone). `GET /v1/admin/branches` moves from 01b to 01a and the owner app shows branch names (S58, supersedes S37). Lines sold by g / ml are weighed to 50 g / 50 ml and priced to the nearest whole rupee; `lineTotalMinor` rounds to 100 minor units (S59, owner answer Q6.13; resolves the [ASSUMPTION]). Q6.10 (batch items) needs nothing: batch is chosen per item in the item form. §3.3, §4.2, §4.3, §4.4, §5.2, §6.0, §6.7b (new), §6.11, §6.14, §6.16, §6.24, §8.1, §12.2, §12.4–§12.7 edited; test 150 reworded; tests 173–179; plan tasks 81–84. 28 endpoints. v1.1 — **APPROVED** by the owner (2026-10-26) after hostile review 3. **v1.1 over v1.0.2: the module 01a design hand-off (`docs/design/handoff/01a/`, `PLAN.md` §A).** Client only: no endpoint, contract, error code, event or migration changes. Urdu on the 01a pages (S49, amends §8.3); owner app shell, archive and discard dialogs, error texts and what the pages show when the API has no number (S50); bulk add of tables as a page loop over §6.5 (S51); branch choice kept per tab, one branch auto-picked, menu with no branch (S52); cloud-unreachable banner (S53); stock page wording, filters, add sheet, sign out and hub admin shell (S54, amends §8.2 text); typed counts kept after an idle sign-out (S55); "All N are still right" and saves over 200 rows (S56). §6.7, §8.1, §8.2, §8.3, §12.4 and §12.7 edited; test 77 reworded; tests 159–172. Hostile review 3 (`docs/reviews/01a_spec_review_3.md`, 3 Blockers, 7 Should-fix, 10 Nits) applied: the cloud-unreachable banner probes after a failed save (B1, S53); the stock page shares 00's five admin session keys (B2, S54 g); kept counts are keyed by the day's `opened_at` and never overwrite a newer count (B3, S55); S-1–S-7 and nits 1–10. v1.0.2 — **APPROVED** (2026-10-26). **v1.0.2 over v1.0.1: four owner rulings on the open items of `docs/reviews/01a-auto/whole-module-check.md`.** (1) §6.19 returns `category_name` in `items_meta` and `day_min_gap_hours`, so the stock page shows category names and the `opened_recently` text names the branch setting (§8.2). (2) S46: the low-stock threshold is in the item's own `stock_unit` (both on the item row); while the open day's frozen `stock_unit` differs, `stockLevel` gives no `low` that day, and the alert resumes at the next day open. (3) §6.19 `items[].unit` is `dayUnits(state, item).stock_unit` (the open day's frozen unit, else the config's); a count recorded in another unit is reported as no count. (4) S26: a PATCH (§6.4–§6.15) whose merged row equals the stored one, and a route `PUT` (§6.16) that leaves the route as it is, write nothing: no row update, no `config_audit` row, no version bump. Tests: 39 changed, 155–158 added. v1.0.1 — **APPROVED** (2026-10-26). **v1.0.1 over v1.0: editorial, plus the three owner decisions taken during the build (`docs/reviews/01a-auto/decisions.md`).** D5: the owner and hub admin request and response Zod schemas live in `@pos/events` (`packages/events/src/admin/`), and the cloud routes and `src/api/{cloud-admin,hub-admin}.ts` both use them (§7.7). D6: `ship-client.sh` ships only while `systemctl is-active hub` prints `inactive` or `failed` (§7.8 step 5 b). D7: `GET /admin/queries/config-status` also returns the hub's provisioned `tenant_id` and `branch_id`, which the stock page puts in every command envelope (§6.21). Editorial: §4.3 states the station order the builder already uses (by name, then id); §8.1 names the S44 field "Grams per piece" / "Millilitres per piece"; S18 and §5.2 record the cloud migration `0003_manage_stock_backfill.sql`, which grants `manage-stock` to the Owner and Manager roles of tenants seeded before 01a (parked pilot blocker). No other behaviour change. v1.0 — **APPROVED** (2026-10-25). **v1.0 over v0.7.1: review 2 (`docs/reviews/01a_spec_review_2.md`) applied with the owner's decisions.** B1: the business day is **open → closed**; new hub command `CloseBusinessDay`; `OpenBusinessDay` opens only when no day is open; stock commands answer `409 BUSINESS_DAY_NOT_OPEN` while none is open and the stock page offers a large Start day action; a stale-day prompt after `day_stale_after_hours` (default 16); the close guard is `day_min_gap_hours` (default 4); both are branch settings (S33). S-1: a line is served from stock only when the whole line fits (`canServeFromStock`, S14). S-2: unit changes take effect at the next day open; units are frozen per day (S44). S-3: stock pools are 01c's, `group_label` stays, `lineTotalMinor` [ASSUMPTION] in `@pos/domain`, bill rounding 05's (§4.4). S-4: the hub publishes `hub_time`; clients never use the device clock (S47). S-5: off-thread snapshot work deferred to a 1 000-item trigger; the stock poll is split and short-circuited by versions (§6.19, §12.4). S-6: the tenant-wide guard reads `owner_users` at write time (S8). S-7: guard hours are settings; prices in minor units; "manual On does not override a window" is an [ASSUMPTION] (owner question 12). Nits 1–10 applied. Tests 133, 142–144 rewritten; new tests 145–154. 27 endpoints. Self-check of the changed parts found no blocker. **v0.7.1 over v0.7 (owner correction): the business day is opened by an action, not by the date.** `OpenBusinessDay` is no longer idempotent per local date (a restaurant runs past midnight; the day starts with the shift): with a day open it appends nothing unless the request says `end_current_day: true`, and even then not within 4 h of the last open (double-tap guard); D32 replay as usual (S33, §6.18a). The stock page shows a large **Start day** action where the 409 would appear, then continues the entry (§8.2). Tests 142–144. **v0.7 over v0.6.1 (owner answers, product direction, 01c split):** product direction P1–P4 (configurable, not programmable; settings are data; cross-platform hub; milestone A moves to 2027-02-28). Owner answers applied: stock and sale **units** per item, integers in the smallest unit (S44); **`StockAdded`** and the hub command `AddPrecookedStock` (S45); **low-stock threshold** per item with a derived low/out level (S46); **`carries_over`** per item resolves the S41 assumption (S41); manual Off carries over, confirmed (S30); **time windows** per item and per category (S47); the **business day comes from `OpenBusinessDay`**, and `business_day_start_ms` and `businessDayStartedAt` are removed (S33); the owner menu read gets **search and cursor pagination** and **`can_edit_tenant`**, and the snapshot is sized for 5 000 items with a gzip response (S48, §6.11, §6.1). Modifiers, variants and deals move to the new spec **01c**, written before 02 (S12, §12.5). Carried to 01b, 02, 05 (§4.4). Answered owner questions and resolved assumptions removed (§12.6, §12.7). New code `BUSINESS_DAY_NOT_OPEN`. Removed test number: 104 (not reused); new tests 128–141. 26 endpoints. **v0.6.1 over v0.6 (editorial addition):** the browser-safe import rule for `packages/engine` and the root of `packages/domain` (S35 k), enforced by lint, test 127. v0.6: Hostile review 1 (`docs/reviews/01a_spec_review_1.md`) applied; the plan is re-baselined after the owner visit (§12.6). v0.6 over v0.5: **scope cut** (owner decisions on the review's cut candidates): the `config_epoch` (S29 a/b), the directory resend (S36), the 00 v1.3 `allowNotNewer` change, `epoch_changed_at` and its banner are removed and replaced by the cloud CLI `restore-bump` (S42); the multi-version snapshot negotiation of S28 (b, e, `SNAPSHOT_SCHEMA_MIN_SERVED`, `SNAPSHOT_SCHEMA_UNSUPPORTED`, `upgrade_required`) is removed, leaving one schema version with additive optional fields (S28); `POST /admin/config/pull-now` is removed (S24, §6.20); the `--business-day-start` CLI option is removed (S33). These cuts also close review findings B1, S-2 and S-8. **Parking** is an order type again (F §5.9, E2 AC9), not a floor (S10). **Review fixes:** a failed apply is visible and each part is retried alone (S43, B2); the hash covers the exact wire JSON (S27, S-1); stock counts are valid for one business day [ASSUMPTION] (S41, S-3); every confirmed count appends `StockSet` (§6.17, S-4); `on_hand < reserved` carried to 03a (S14, S-5); archived tax classes and programs stay in the snapshot and order lines copy program cook times (S22, §4.4, S-6); tenant-level writes need an owner who covers every branch (S8, S-7); boot placement of the stock fold and the config load (S15, S-9); on-site release outside service hours (S39, §7.8, S-10); happy-path and merged-row tests (S-11); idempotency request hash and prune (S7, S-12); review nits 1–10 (§6.1, §5.1, §6.14, S35 j, S21, §12.1, §4.3, §7.3). `businessDayStartedAt` moves to `@pos/domain` (S33, S41). Assumption isolation listed in §12.7. Removed test numbers: 55, 96–101, 109–112 (not reused); new tests 114–126. 24 endpoints. v0.5 over v0.4: plan-review decisions S40 (N1–N12 of `docs/reviews/01a_plan_review.md` follow-up: `@types/node` dev dependency in `packages/domain`; `onBranchConfigApplied(prev, next, tx)`; D54 exception for the tenant-wide bump; poll outcome `not_ready`; `pull-now` answers `200` for every hub-decided outcome; S25 line 8; money parsing drops commas; `set_at` in the stock result; `QueryCtx.branchConfig`; performance targets checked by runbook; automated and runbook parts of tests 75, 102, 103, 104 (all parts automated); first-boot replay risk); S35 confirmed by the owner, with limits: one Vite app with one entry per surface, a closed dependency list, no router/state/form library or CSS framework, styling from `packages/ui-kit` only, shared components in `src/components/` for 02 to reuse (S35 a, d, g, i); S20 removed (S35 is the only page pattern for 01a and later client work); client build and hub/cloud release specified (S39, §7.8, plan review #18); test 113. v0.4 over v0.3: owner pages and `/admin/stock` are React entries in `apps/client` built with Vite (S35, supersedes S20 for 01a's pages); `rotate-config-epoch` also forces a staff-directory resend (S36, closes Q4); `GET /v1/admin/branches` confirmed in 01b (S37, closes Q3); Q1 waits for owner question 8 (S38); tests 109–112. v0.3 over v0.2: snapshot schema versioning, with the hash checked over the raw JSON (S28); `config_epoch` against version regression after a cloud restore, with visible poll problems (S29); "Off since" for availability carried across days (S30); tax rate resolved at bill close (S31); [ASSUMPTION] `out_of_stock_behaviour` (S32) and `business_day_start_ms` (S33); optional tax: nullable `tax_class_id` and `branches.tax_enabled` (S34); both branch settings set by the CLI `set-branch-settings` in 01a, owner endpoint in 01b (§6.7); owner questions merged (§12.6); tests 94–108. v0.2 over v0.1: endpoint count corrected; S10 override of the E1 station-name edge case; WS pushes and catch-up parts (§4.5); cloud `config_audit` (S26); `canonicalJson` / `sha256hex` in `@pos/domain/hash` (S27); `set_at` in the stock slice (S14); 00 drift decided (S25); permission/audit table (§6.0); tests 80–93 |
| Date | 2026-11-03 (v2.1); 2026-11-02 (v2.0.1); 2026-10-29 (v2.0); 2026-10-28 (v1.3.1); 2026-10-27 (v1.3); 2026-10-26 (v1.0.1, v1.0.2, v1.1, v1.2); 2026-10-25 (v1.0) |
| Depends on | Foundation Spec v1.7 (APPROVED — FINAL); 00 Hub Platform & Access v1.5 (APPROVED; implemented except §10 #79). *⚠️ Changed by 03a v1.0:* v2.1 is written against foundation v1.9, 00 v1.7, 01b v1.5 (B-6, B-8), 01c v1.1.1 and 03a v1.0 |
| Inherits | **Shared Standards from Foundation v1.7 §6**, unchanged except where a decision in §3.1 names the section it overrides (D64) |
| Tier | T2 Production (foundation §1) |
| Milestone | A (pilot, target 2027-02-28, P4; re-estimated after 01a is built). 01a is on the critical path to 03a and 02. 01b is also required for milestone A, before the first live order (S2) |

### Stories covered

| Story | ACs covered here | Elsewhere |
|---|---|---|
| E1 Floors, tables, and stations | 1, 2, 3 (narrowed by S9, S10), 3 batch programs, 4, 5, 6 (data part: archived station stays in the snapshot) | 3 live capacity override (D37) → 03a; 6 and edge case "warn admin about in-flight tickets" → 03b (§12.4) |
| E1 Menu item recipe route | 1, 2, 4 (narrowed by S11), 5 | 3 modifiers → **01c** (S12) |
| E1 Pre-cooked stock — daily entry | 1 (count, plus adds, S45; units, S44; per business day, S33, S41), 2 (manager view, low/out level, S46), 6 | 2 (ordering screen countdown) → 02; 3, 4, 5 (reservation, first-submit-wins, slow mode) → 03a / 02; 5 for `sold_out` items narrowed by S32 [ASSUMPTION] |
| E0 Categories, items, variants, add-ons, combos | 1, 2 (no image, S13), 3 (stock time, with E1 route AC2), 7, 8 (tax class on the item, **optional**: overridden by S34); edge case zero-price item | 4, 5, 6 (variants, add-ons, combos) → **01c** (S12); per-item tax calculation → 05 |
| E0 Item availability | 1, 2 (data for it), 3 (data for it), 4 (time windows per item and category, **narrowed** by S47: time of day only, no days of week), 5 (**overridden** by S47: a manual Off always wins) | greyed-out display and rejection at order → 02 |
| E0 Staff — PIN login | — | 1 (duplicate PINs rejected) **dropped** by 00 M27: duplicates are allowed, because salted hashes make detection impossible; 7 → 01b |
| Carried requirements | 00 §4.2 `registerStationValidator` (M31); cloud `idempotency_keys` (M69); BYOD exit revoke runs through 01a's pull (R14, M38) | Staff/role admin, PIN, lockout notice → 01b |

### In scope
- Cloud canonical restaurant data: floors, tables, stations, batch programs, tax classes, categories, menu items, and per-branch item routes (§5.2).
- Cloud owner pages for that data (§8.1) and the hub page `/admin/stock` (§8.2), as React entries in `apps/client` (S35).
- The cloud `idempotency_keys` store for every creating `POST` (S7).
- The cloud `config_audit` trail for every owner config write (S26).
- Config delivery: `GET /v1/sync/config` with a conditional `304`; the hub poller; the `BranchConfigApplied` event with a content-addressed snapshot store; the staff directory delivered by the same poll through 00's `applyStaffDirectory` (S3–S6).
- Hub: `registerStationValidator`; the in-memory branch config; pre-cooked stock counts (`StockSet`) and adds (`StockAdded`, S45) and the stock slice of the engine fold (S14, S15); opening and closing the business day (`OpenBusinessDay`, `CloseBusinessDay`, S33); the manual item availability toggle (S17); one hub admin page for stock and availability with low/out alerts (§8.2, S46).
- Item settings as data (P2): stock and sale units (S44), low-stock threshold (S46), `carries_over` (S41), time windows per item and per category (S47).
- **Staff in dev and test come only from `seed-tenant` (00 §6.26) until 01b ships.** 01a reads staff only through the directory that 00 already builds.

### Out of scope
- Staff/role admin, PIN set/reset, staff-to-branch assignment, the last-admin guard, the owner lockout notice → **01b** (§12.5).
- Live station capacity override (D37), `StockReserved` / `StockReleased`, ETA recalculation on a stock change (D23), and the engine's reaction to a station config change → **03a**.
- Table state, the table map, order lines, the ordering-screen stock countdown, unavailable items shown greyed out → **02**. **Parking** is an order type with no table, identified by the car number (F §5.9, E2 AC9), owned by 02 (S10, §4.4).
- Tax arithmetic, rounding, resolving the rate at bill close, tax by bill type and payment method, shifts and cashier handover → **05** (S31, S34, §4.4). 01a stores only an optional tax class, its rate, and the branch's `tax_enabled` flag.
- Owner endpoint for branch settings (`tax_enabled`) → **01b**, with `GET /v1/admin/branches` (§12.5). In 01a, `tax_enabled` is set only through the CLI `set-branch-settings`.
- Variants (sizes, half/quarter, weighted items), modifier groups and deals/combos → **01c**, written after 01a and before 02 (S12, §12.5).
- A "Get changes now" button and snapshot schema negotiation between cloud and hub versions (cut in v0.6, §12.4). Cloud restore itself is 06's; 01a provides only the `restore-bump` CLI (S42).
- Drag-and-drop floor canvas, table shape and position (S9); item images (S13); days-of-week availability (S47, §12.4); price lists (v1.2: a per-branch price is in scope, S57); a user-built workflow engine (P1).

> ⚠️ Changed by 01c v1.0 (A1): variants (sizes, half/quarter, weighted items), modifier groups and deals are specified by 01c v1.0: a variant is a `variant_groups` member item, and `group_label` is replaced by `variant_group_id` + `variant_name` (01c V2). See 01c §4.5.

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Cloud owns the menu catalogue, prices, station routes and roles; the hub caches them read-only | F §3.1, §3.3 |
| Hub owns live pre-cooked stock and item availability (D26, D50) | F §3.1 |
| Single stock authority: stock exists only as `StockSet` / `StockReserved` / `StockReleased` events (01a adds `StockAdded`, S45) and the one engine projection; no SQL stock table | F §3.1, D50 |
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

**Product direction (owner, 2026-10-25).** These apply to 01a and to every later module; the README records them as R18–R20.

| # | Decision | Reason | Effect in 01a |
|---|---|---|---|
| P1 | **Configurable, not programmable.** The POS is a multi-restaurant product. Every behaviour that differs between restaurants is a setting with a sensible default. There is no user-built workflow engine now. A setting is added only when an owner answer asks for it. | One product for many restaurants, without a rules engine nobody has asked for. | The new item settings (S41, S44, S46, S47) each answer one owner answer and each has a default that keeps today's behaviour |
| P2 | **Settings are data, never code branches.** Every restaurant-specific behaviour (time windows, thresholds, units, `carries_over`, tax rules, permissions) is stored as rows the owner pages edit, so a future visual (drag-and-drop) editor edits the same data. | A setting in code would need a release per restaurant, and a visual editor could not reach it. | Every new setting is a column or a row in §5.2 and a field in the snapshot (§4.3); no code checks a tenant or a restaurant name |
| P3 | **The hub stays Node + SQLite and cross-platform.** No Linux-only API in `apps/hub/src`; `systemd` stays in `apps/hub/deploy/` only. A Windows hub install path (Windows service, power and update settings) is offered later next to the recommended Linux hub box (README "later"). The pilot uses the Linux box. | A restaurant without a spare Linux box must still be able to run a hub. | 01a adds no Linux-only code to hub `src` (`ship-client.sh` is in `deploy/`). Existing Linux-only code found in hub `src`, **listed, not changed** (00's code): `setup/issue-admin-bootstrap.ts:76` `process.getuid!()` (undefined on Windows); `config/write.ts:28–30` fsync of the directory through `openSync(dir, 'r')` (fails on Windows); `config/schema.ts:59` `DEFAULT_CONFIG_PATH = '/etc/pos-hub/config.json'`; file modes `0o600` (`config/write.ts:11, 21`, `db/pre-migrate-backup.ts:23`, `lib/crypto-file.ts:20, 38`), which Windows does not enforce |
| P4 | **Milestone A target moves to 2027-02-28**, re-estimated after 01a is built. | 01c is added before 02, and the owner answers widen 01a. | §1 header; README milestones |

Each module decision states the failure it prevents and any foundation or 00 section it overrides.

| # | Decision | Prevents / reason | Overrides |
|---|---|---|---|
| S1 | **01 is split into 01a (this spec), 01b (staff and role admin) and 01c (menu: variants, modifiers, deals; v0.7).** All of 01 in one spec is about 32 endpoints/commands, over the split threshold (README size budget). 01a holds what 02 and 03a build on. 01b writes only 00's existing tables (00 §5.2), so it can be built alongside 02. 01c is written right after 01a and **before 02**, because it shapes the `OrderPlaced` line (S12). | One oversized spec on the critical path. | README module map (row 01 → 01a, 01b, 01c) |
| S2 | **01b is required for milestone A, before the first live order.** Until it ships, staff and PINs exist only through `seed-tenant`, for dev and test. | A pilot with CLI-made staff cannot reset a PIN or remove a fired employee. | README milestones |
| S3 | **Config pull, built in 01, reused by 06.** The hub polls `GET /v1/sync/config` every 60 s (v0.6: no manual "Get changes now", S24). Each 200 carries the **whole** branch snapshot (§4.3) and/or the staff directory. There is no `hub_push_queue` diff queue. | Milestone A has no 06 sync, so without this no menu change, PIN reset or staff removal would reach a hub after provisioning. A whole snapshot (~60 KB for the pilot's < 200 items; ≤ ~2.5 MB, ~300 KB gzipped, at the 5 000-item design size, S48) cannot get out of order, cannot lose a diff, and cannot apply half an edit. | F §3.3 mechanism ("cloud adds a record to `hub_push_queue`; hub fetches it on the next sync poll") |
| S4 | **Conditional GET.** The hub sends `config_version` and `directory_version`. When both equal the cloud's, the cloud answers **`304 Not Modified` with no body**, after one SQL statement (plus the tenant guard's key lookup, §6.1). | The restaurant is on mobile data; a full snapshot every 60 s is ~85 MB a day per branch. | F §6.1 "every response has a body (no 204)", for this route's 304 only |
| S5 | **Applying config is an event.** A new snapshot is applied in one `writer.run`: `INSERT OR IGNORE` the body into `config_snapshots` (content-addressed by `snapshot_hash`, insert-only, triggers block UPDATE and DELETE), append `BranchConfigApplied { config_version, snapshot_schema_version, snapshot_hash, previous_config_version }`, and update the `branch_config` projection. The in-memory config swaps after COMMIT (D45). **How replay gets the body:** the `branch_config` projection keeps `snapshot_hash` from the last `BranchConfigApplied`; boot and replay read the body from `config_snapshots` by that hash. The table is in the hub database, so the USB backup carries it. After a **cloud-only** restore, or a USB restore followed by the cloud tail (F §5.10), the last event's hash may have no body: boot then finds the body missing, the hub treats its `config_version` as 0, and the next poll fetches the current snapshot in full (§3.4 step 2). The hub opens `/auth/*` only after that poll (requirement on 06, §4.4). | A cache write outside the event log would make replay and restore build a different config from the live hub, and audit could not say which menu was live when. Keeping the body out of the payload keeps 60 KB rows out of the immutable log and out of sync traffic. | — |
| S6 | **The staff directory rides the same poll.** If the cloud's `tenants.directory_version` > the hub's, the 200 carries the directory, and the hub calls 00's `applyStaffDirectory(tx, directory, setDirectory)` **in the same `writer.run`** as any config apply; if that transaction fails, each part is retried alone (S43). 01a is the first caller (00 §4.2 lists 06). M50, M51, M52, M75 and the M38 `owner_removed` phone revoke run unchanged; 00's function is called with its existing signature. **Known limit:** while the branch is offline, a removed staff member keeps working on that hub until the next successful poll (§7.6). | Without it the BYOD exit revoke (R14) never fires in the pilot. | 00 §4.2 caller of `applyStaffDirectory` (01a, then 06) |
| S7 | **Cloud `idempotency_keys` (M69).** Every creating `POST` under `/v1/admin/*` requires `Idempotency-Key` (ULID). The key row is inserted **first, in the same transaction as the create**. A concurrent second request with the same key blocks on the primary key until the first commits, then reads the stored response. Same key + same request hash → stored status and body with `Idempotent-Replay: true`. Same key + different hash → `422 IDEMPOTENCY_KEY_MISMATCH`. Only successful responses are stored; a failed request rolls the key back. **Request hash (v0.6):** `request_hash = sha256hex(canonicalJson({ method, path, body }))`, where `path` is the route path with its parameters filled in (e.g. `/v1/admin/branches/<b>/floors`), so the same key on another branch's path is a mismatch, not a replay. **Prune (v0.6):** rows older than 24 h for that tenant are deleted after the create's COMMIT, in their own statement `DELETE FROM idempotency_keys WHERE ctid IN (SELECT ctid FROM idempotency_keys WHERE tenant_id = $1 AND created_at < $2 LIMIT 100 FOR UPDATE SKIP LOCKED)` (index `idempotency_keys_age`). It takes no lock inside the create's transaction, so it is outside S8's lock order and cannot deadlock with another create; a prune failure is logged and does not change the response. | F §6.4: an owner on mobile data retrying "add item" would create duplicates. Inserting first in the same transaction removes the need for an "in progress" state. A body-only hash would replay branch A's floor for a request on branch B. A prune inside the transaction would serialise every create on the same old rows. | — |
| S8 | **Version bumps.** Every cloud config write bumps `branches.config_version` in the same transaction: the edited branch for branch-level data (floors, tables, stations, programs, routes), **every branch of the tenant** for tenant-level data (tax classes, categories, items). `UPDATE … RETURNING` also serialises concurrent config writes per branch. Lock order: the target row, then reference rows (`FOR SHARE`, in id order), then the branch rows last, in `branch_id` order (the tenant-wide bump first runs `SELECT … ORDER BY branch_id FOR UPDATE`), so two writes cannot deadlock. Directory bumps are 01b's (00 M51). **Tenant-level writes need an owner who covers the whole tenant (v0.6):** the tenant-wide bump's locking `SELECT` already reads every branch of the tenant; if any of them is missing from the owner's allowed branches, the write fails with `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`, and the transaction rolls back (nothing written, no audit row, no key stored). **v1.0 (review 2 S-6): the allowed branches are read from the database at write time**, `SELECT allowed_branch_ids FROM owner_users WHERE tenant_id = $1 AND user_id = $2` (JWT `sub`) in the same transaction, never from the JWT claim: `issue-registration-code` appends a new branch to every owner's row (`cli/issue-registration-code.ts:68`), and a token issued before that would otherwise lock the owner out of every tenant-wide edit until it is refreshed. Branch-level writes keep the `404 BRANCH_NOT_FOUND` path check. **v1.3 (01b B11): directory writes** (01b's staff, role and responsibility routes, and the `issue-registration-code` CLI) take `tenants … FOR NO KEY UPDATE` first, then their target rows in id order, and read reference rows (floors, stations, roles) without a lock; they take no explicit lock on `branches`. Config writes keep the order above. **Correction (01b review 1 m5):** config writes do touch the tenant row: an insert into a table that references `tenants` (tax classes, categories, menu items, availability windows) takes the foreign key's `FOR KEY SHARE` on it. That lock does not conflict with `FOR NO KEY UPDATE`, so config and directory writes never wait on each other there; a directory insert into `staff_branches` takes `FOR KEY SHARE` on a `branches` row and may wait for a config write holding it, which never waits on the directory write. No cycle (01b B11). | A per-tenant counter would make all three hubs download after a table rename at one of them. An owner limited to branch A (`allowed_branch_ids` can be a subset, `cli/issue-registration-code.ts:68`) must not change prices or archive items at B and C (D30). | — |
| S9 | **Floor editor narrowed:** floors (name, sort order, archive) and tables (name, floor, optional seats, sort order, archive). No canvas, shape or x/y. 02 shows tables as a tile grid per floor in sort order. Nullable `pos_x` / `pos_y` can be added later with a forward-only migration. | Nothing in E2–E8 reads a position; a canvas editor is the largest UI in the module. | E1 AC1 (2D canvas), AC2 (shape, position) — narrowed |
| S10 | **Stations belong to the branch, not to a floor.** Station names are unique per branch; an optional `location_label` ("Ground floor, back") says where it is. **Parking (v0.6, reverts v0.5's parking-as-floor):** parking is an **order type** with no table, as F §5.9 ("takeaway, parking and delivery orders have no table; no lock check") and E2 AC9 ("parking (car description)") say. Its data is 02's (v0.7, owner answer): the **car number** is the main identifier, shown like a table number, plus a car type picker (sedan / mini / large, with icons) and an optional phone number (§4.4). 01a models no parking data. | The engine never reads a station's floor. With no floor on a station, "same name on a different floor" has nothing to tell the two apart on a KDS or ticket; the label says where the station is ("Fryer" + "Back kitchen"). | E1 AC3 (station "floor and position") — narrowed; **E1 edge case "two stations with the same name on different floors → allowed" — overridden**: station names are unique per branch (`409 CONFIG_NAME_TAKEN`), and `location_label` says where each station is |
| S11 | **Recipe route is per branch.** The menu (categories, items, prices, tax classes) is tenant-wide; each item has at most one route per branch (`item_routes`: station, and at a batch station a `program_id` and an optional `stock_program_id`). An item with no route at a branch is not sold there and is not in that branch's snapshot. A program is allowed only at a batch station, and a batch station requires one ("batchable" = routed to a batch station with a program). Same menu at all branches; v1.2: a branch may have its own price for an item (S57, owner answer Q6.5). | Stations are per branch, so a tenant-wide route could point at another branch's fryer. | E1 route AC4 "marked batchable (yes/no)" → derived from the route |
| S12 | **Variants, modifiers and deals are 01c's (v0.7, owner answer).** 01c Menu specifies variants (sizes, half/quarter, weighted items), modifier groups (extras and sides as categories; paid or free; min/max) and deals/combos (each part routed to its own station). It is in pilot scope and is written right after 01a and **before 02**, because it shapes the `OrderPlaced` line (§12.5). 01a's item is the base 01c builds on; until 01c, a size is its own item with an optional `group_label` ("Chicken Karahi") so the owner pages can show the sizes side by side, and free requests go in 02's kitchen note (§4.4). 01c may replace `group_label` with its variant model. | Building 02's order line before the variant and modifier model is known would change `OrderPlaced` after it ships. | E0 menu AC4–6 → 01c |
| S13 | **No item image or description upload in 01a.** `description` is an optional text field; images are deferred. | Uploads need object storage and an extra dependency; the order screen works without photos. | E0 menu AC2 (image) deferred |
| S14 | **Stock shape: on hand, reserved, set at, unit.** `EngineState.stock: Record<ItemId, { on_hand: number; reserved: number; set_at: number \| null; unit: 'piece' \| 'g' \| 'ml' }>`, and **available = max(0, on_hand − reserved)**, all integers in the item's `stock_unit` (S44). `StockSet` sets the physical count the manager sees in the pot (`on_hand`), which still includes units reserved for orders not yet served. 01a's fold handles `StockSet`: `on_hand = count`, `unit` = the event's unit, `set_at = event.recorded_at` (from the event, so replay gives the same value), `reserved` unchanged (0 for a new item); and `StockAdded` (S45): `on_hand += quantity`, `set_at` and `unit` unchanged; **a `StockAdded` whose `unit` differs from the entry's `unit` leaves the entry unchanged and reports an invariant breach, which the hub logs; no stock fold throws** (⚠️ Changed by 03a v1.0 (A-20, 03a §3.7): was "throws", review 2 nit 1. The command still never appends such an event (S45), so the case stays a bug signal, now one that cannot fail an unrelated transaction). `on_hand` has no cap after adds beyond `Number.MAX_SAFE_INTEGER`. An item with no entry reads as `{ on_hand: 0, reserved: 0, set_at: null, unit: 'piece' }` (E1 stock AC6). Apart from display, `set_at` and `unit` are read only by the validity rule of S41. 03a's `StockReserved` / `StockReleased` change `reserved`, and the step that hands a unit over moves it out of both. **Serving from stock (v1.0, review 2 S-1):** everywhere F §4.7 says "pre-cooked stock > 0", it means `canServeFromStock(availableStock(…), quantity, stock_per_sale_unit)` (`@pos/engine`): true only when `available ≥ quantity × stock_per_sale_unit`, the stock units the whole line needs (S44). 100 g left with 250 g plates, or 300 g left for a 500 g weighted line, is **not** served from stock; 03a then follows `out_of_stock_behaviour` and defines whether a line may be split. **Invariant (v0.6):** `on_hand ≥ 0` and `reserved ≥ 0` always; no fold step may take either below 0. **A count below the reserved units** (`StockSet` with `on_hand < reserved`, e.g. `{ on_hand 5, reserved 5 }` then a count of 3) leaves `reserved` unchanged and `available` 0 in 01a; 03a re-plans the excess reservations (§4.4). **Recorded race:** a count taken while a reserved unit is being plated can be off by that unit; the next count corrects it. | A single number set by the manager would erase reservations made between reading the screen and saving, and the same units would be sold twice. | F §4.7 `EngineState.stock: Record<ItemId, number>` and "pre-cooked stock > 0" |
| S15 | **01a creates `@pos/engine` with the stock slice only** (`state.ts`, `apply-event.ts`, `stock.ts`, `version.ts`), replaces the identity reducer at `lib/boot.ts:279` with `applyEvent`, and registers a **boot step 3** handler that folds the `stock` stream (`StockSet`, `StockAdded`) and the `BusinessDayOpened` / `BusinessDayClosed` events (S33) from `initialEngineState()` and puts the result in `ctx.initialState`; `createDeps` builds the state holder from it (the additive `BootContext` change in §2, v0.6). **Config load (v0.6):** the in-memory `branchConfig()` and its hash are loaded from `branch_config` + `config_snapshots` in a **boot step 5** handler, which runs after step 4 (`projections.catchUp`, `lib/boot.ts:153`), so a projection that was stale at boot (a USB restore plus the cloud tail, F §5.10) is caught up first. The server does not listen until after step 6, so no request and no station validation sees a config older than the projection. 03a replaces the step-3 fold with full replay and snapshots, and extends `applyEvent`. *⚠️ Changed by 03a v1.0 (A-15): done by 03a v1.0 (§3.12): boot step 3 is 03a's replay from the latest snapshot or day-close checkpoint; `stock_version` is read with 2 statements (A-17).* | Without a fold the manager's stock screen is empty until 03a, and a restart loses every count. A step-3 handler today cannot reach the state holder, which is created later (§2). | — (00 drift: `setReducer`, §2; additive `BootContext.initialState`, §2) |
| S16 | **`QueryCtx` gains `state` (read-only engine state) and `branchConfig` (the in-memory branch config; named so it is not confused with `CommandCtx.config`, the hub config file, S40 N9).** | The stock query must read the one stock authority (D50) without a table. | 00 §4.2 `defineQuery` ctx (additive) |
| S17 | **Item availability is a hub event pair.** `SetItemAvailability { item_id, is_available }` appends `ItemMadeUnavailable` or `ItemMadeAvailable` (one fact each, F §6.6), or nothing if the item is already in that state. Projection `item_availability`; a missing row means available. | D26 makes availability hub-owned and offline. | — |
| S18 | **Stock and availability are hub admin commands** (`sessionKind: 'admin'`) under a new permission **`manage-stock`**, granted by default to Owner and Manager (`default-roles.ts`). In 01b, custom roles can give it to a head cook. They also need `access-hub-admin` to open the page. **v1.0.1:** tenants seeded before this permission existed get it through the cloud migration `0003_manage_stock_backfill.sql` (§5.2), which grants it to every existing Owner and Manager role (`ON CONFLICT DO NOTHING`) and raises `tenants.directory_version` only for tenants that gained a row, so their hubs download the new grants. | Stock must work with the internet down (hub-owned, D50) and from one tablet. | — |
| S19 | **Owner pages are cloud-served, owner accounts only.** Menu, tax classes, stations, programs, floors and tables are edited on cloud pages (`/owner/*`) by `owner_users` (00 JWT). Managers do not log in to the cloud in P1. Stock and availability live on the hub page `/admin/stock`. | The cloud owns the menu (F §3.1) and editing it needs no offline mode; the hub owns stock and availability, and the stock count must work offline. | — |
| S20 | **Removed in v0.5.** v0.3 chose static `.html` + ES-module `.js` pages with no bundler (`apps/{hub,cloud}/src/pages/`); v0.4 superseded it for 01a's pages; the owner confirmed S35, so no 01a page and no later client page uses that pattern, and no `src/pages/` folder is created. The number is kept so older references resolve. 00's hand-written pages (`/setup`, `/pair`, `/admin/bootstrap`, `/admin/approve`) are 00's own decision (M81, M82) and are not changed by 01a. | **Why removed:** the menu editor is form-heavy (items with per-branch routes, tax picker, money and minute fields, archive/restore), which is what a component framework is for; and 02 needs the same React client and the same components (PIN pad, staff tiles) for its login, ordering, cashier and KDS screens. Pages built on S35 now are reused by 02; pages built on S20 would be thrown away when 02 starts. | — (v0.3's F §6.9 addition of `src/pages/` is withdrawn) |
| S21 | **Cloud owner pages are served without tenant scope.** `GET /owner/*` on the cloud is static (the Vite build, S35), embeds no data and sets `tenantScope: 'none'`; the prefix joins the allowlist. v0.4: the cloud no longer serves `/ui/*`, because the build bundles the UI kit CSS and fonts (S35 d). Data comes only from `/v1/admin/*` under the JWT. Pages are sent with `Content-Security-Policy: default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` (v0.6: `base-uri` and `form-action` are not covered by `default-src`). The hub sends the **same header** on `/admin/stock/*`, whose admin session token is in `sessionStorage` as on 00's pages (`auth/admin-bootstrap.ts:132`). | The JWT lives in `sessionStorage` on an internet-facing page; a script injected through an item name would steal it. The hub admin token is worth the same protection on the LAN. | F §3.4 item 1 (allowlist) |
| S22 | **Archive, never delete.** Floors, tables, stations, programs, tax classes, categories and items are archived (`archived_at`) and can be restored. Archiving something still in use is refused with `409 CONFIG_IN_USE` (a floor with active tables, a station or program with active routes, a category or tax class with active items). An archived item disappears from new orders; open orders keep their copied lines (§4.4). Archived **stations** stay in the snapshot with `is_archived: true`, so KDS tickets already routed to them still render; `registerStationValidator` refuses them for new pairings. **v0.6:** archived **tax classes** and archived **programs** also stay in the snapshot with `is_archived: true`, so an open order's copied `tax_class_id` can still be resolved at bill close (S31) and a copied `program_id` can still be named on a ticket. New orders and routes never pick an archived row (§3.3). | Hard deletes would break history (E0 AC7) and the D25 copies' references. Without the v0.6 rule, an item moved from class X to Y with X then archived would leave an open bill whose `tax_class_id` 05 cannot resolve. | — |
| S23 | **Last write wins on PATCH.** Two owner sessions editing the same row overwrite field by field; no ETag. | One owner, a handful of edits a day; optimistic locking fails the YAGNI test. | — |
| S24 | **Removed in v0.6.** v0.5 had `POST /admin/config/pull-now` ("Get changes now"). Cut for the pilot: the 60 s poll is enough, and the stock page keeps one status line from config status (§6.21, §8.2). Removing it also removes the hub `503` that F §6.2 does not allow (review 1 S-8). The number is kept so older references resolve. | — | — |
| S25 | **00 drift (§2) is fixed by a 00 v1.2.1 editorial patch, with no behaviour change.** Exact edits to spec 00 v1.2 (file renamed `00_Hub_Platform_Access_Spec_v1.2.1.md`, done in plan task 1): **line 481** (§4.2 exports table): export name `registerReducer` → `state.setReducer(reducer)`; shape → "reducer `(state, event) => state`; one reducer, a later call replaces it; folded by the writer inside the transaction, and by replay (03a)"; used by → "01a, 03a". **Line 472** (`defineQuery` row): after "`ctx.db` is a read-only connection" add "; ctx = `{ db, page, directory, device, session }`". **Line 8** (version): "v1.2.1 — editorial (2026-10-25): §4.2 names match the code (01a S25); no behaviour change", and the README row. Behaviour checked: same signature; one reducer in both; the writer folds it (`writer.ts:79`); no replay in either yet. | The spec must match the code before 01a builds on it (CLAUDE.md: code and spec disagree → decide). | — (00 is not frozen; editorial patch) |
| S26 | **Cloud config audit trail.** Every owner config write (§6.3–6.16) inserts one `config_audit` row **in the same transaction** as the write, after it and before `bumpConfigVersion`: `actor_kind 'owner'` with `actor_owner_user_id` (JWT `sub`), or `actor_kind 'cli'` with no user for `set-branch-settings` (§6.7; `restore-bump` changes no config data and writes no row, S42), `entity`, `entity_id`, `branch_id` (null for tenant-level data), `action` ∈ `create`, `update`, `archive`, `restore`, `route_set`, `route_removed`, and `before` / `after` (the row in its wire shape, without `tenant_id`; `before` is null on create, `after` is null on route removal). A PATCH that sets and archives in one request writes one row with action `archive` (or `restore`). Insert-only: triggers block UPDATE and DELETE (F §3.1 audit rule). An idempotent replay writes nothing (the stored response is returned). **v1.0.2 (owner ruling): a no-op writes nothing.** A PATCH whose merged row (and, for categories and items, its `availability_windows` set) equals the stored one, and a route `PUT` whose result equals the stored route (the same route, or `{ station_id: null }` with no route), make no row update, insert no `config_audit` row and bump no version; they answer `200` with the stored entity. The 404 and body-validation checks still run first (test 155). No read endpoint in 01a (§12.4). **v1.3 (01b B21):** `entity` adds `staff`, `role`, `responsibility`, `branch`, `owner_user`; `action` adds `pin_set`, `left`, `returned`, `reports_to_reassigned`, `password_change`, `password_reset`; `actor_kind` keeps the values `owner` and `cli`, and `cli` is also written by 01b's `reset-owner-password` and `link-owner-staff`. | T2 requires an audit trail for admin actions; a price change or an archived item must say who did it and when, and the hub's `BranchConfigApplied` says only which version was live. | — |
| S27 | **`canonicalJson` and `sha256hex` move to `@pos/domain/hash`** (`packages/domain/src/hash.ts`, a **subpath export**, not re-exported from the package root: it imports `node:crypto`, and 02's browser clients import `@pos/domain`). The hub's `lib/hash.ts` re-exports them and keeps `payloadHash`, so its importers do not change. `packages/domain` gets `@types/node` 22.19.1 as a **devDependency** so `hash.ts` typechecks (types only; no runtime dependency; S40 N1). The cloud's `/v1/sync/config` uses the same functions for `snapshot_hash`. The cloud Zod-parses the built snapshot with `BranchConfigSnapshotSchema` **before** hashing: `pg` returns `BIGINT` as a string, and a `"120000"` string would hash differently from the hub's parsed number. **The hash covers the exact wire JSON (v0.6):** (i) the cloud hashes `wire = JSON.parse(JSON.stringify(parsed))` and sends that same `wire` object, so a key whose value is `undefined` is dropped from both; (ii) `canonicalJson` **throws** on `undefined` anywhere in its input instead of writing `null` (today `apps/hub/src/lib/hash.ts:9` writes `null`, while `JSON.stringify` drops the key); task 3 runs the existing hub hash and command tests to prove no current caller (`payloadHash`, `commands/route.ts:145`) passes one; (iii) the `/v1/sync/config` response schema types `snapshot` as `z.record(z.string(), z.unknown())`, so the Fastify serializer never reshapes it. | Two hand-copied serialisers would drift, and every poll would be rejected as a hash mismatch (§3.4 step 4). An optional field left `undefined` on one row would hash as `"x":null` on the cloud and be absent on the wire, so every hub would reject every snapshot: the freeze S28 exists to prevent. | — |
| S28 | **One snapshot schema version; the hash is checked over the raw JSON.** (a) The snapshot carries `snapshot_schema_version` (1 in 01a). `@pos/events/src/config.ts` exports `SNAPSHOT_SCHEMA_VERSION = 1` and `BranchConfigSnapshotSchemaV1`. (b) **Removed in v0.6:** there is no negotiation. The hub sends no schema parameter, the cloud has one builder, and there is no `SNAPSHOT_SCHEMA_MIN_SERVED`, no `409 SNAPSHOT_SCHEMA_UNSUPPORTED` and no `upgrade_required` outcome. **A breaking change** (a new schema version) **is released to the cloud and to every hub together**, outside service hours (3 known hubs, §7.8). A hub that receives a `snapshot_schema_version` other than its own rejects the config part (`schema_unsupported`), appends nothing, keeps its last config and shows the danger banner until it is upgraded (S29). After such a release, a stored body whose `snapshot_schema_version` differs from the hub's `SNAPSHOT_SCHEMA_VERSION` is treated like a missing body (`config_version` 0, §3.4 step 2); the cloud, upgraded in the same release, serves the hub's version, so the hub applies it once and the next poll is a `304`. (c) **Within one schema version the cloud may only add optional fields.** Removing or renaming a field, changing its meaning, or adding one the hub must act on needs a new version. The hub's schemas are not `.strict()`, so Zod drops fields the hub does not know. (d) **Hash first, then parse.** The hub `JSON.parse`s the response text, takes `data.config.snapshot` as raw JSON, checks `sha256hex(canonicalJson(raw)) === snapshot_hash`, and only then Zod-parses it with `BranchConfigSnapshotSchemaV1`. `config_snapshots.body` stores `canonicalJson(raw)`, unknown fields included, so the stored body always hashes to its key. Boot and replay parse the stored body the same way. (e) **Removed in v0.6** (v0.5 re-fetched on every poll while the cloud served an older schema; review 1 B1). | A cloud deploy that adds one field would otherwise change the hash the hub recomputes after Zod drops the field. Every hub would reject every snapshot and freeze on its last menu, with no error visible in the restaurant. | — |
| S29 | **Poll problems are visible, not only logged.** v0.6: (a) and (b), the `config_epoch` and its `rotate-config-epoch` CLI, are **removed**; version regression after a cloud restore is handled by `restore-bump` (S42), and `epoch_changed_at` and its banner are gone. What stays is (c): the poller keeps `last_problem { outcome: 'rejected' \| 'unauthorized', reason, at }` in memory until the next `applied` or `unchanged` poll. `reason` for `rejected` ∈ `malformed`, `hash_mismatch`, `schema_unsupported`, `schema_invalid`, `apply_failed` (S43). Config status (§6.21) returns it, and the stock page (§8.2) shows it as a danger banner. | A hub that refuses every snapshot (bad hash, wrong schema, a failing apply) would otherwise freeze on its last menu with nothing visible in the restaurant. | — |
| S30 | **Availability carries over between days, and the page says so (confirmed by the owner, v0.7).** A manual `Off` stays off until someone turns it on; nothing resets it at the start of a day, and an item that ran out stays unavailable until someone makes it available again. The stock query returns `unavailable_since` (the projection's `changed_at` when `is_available = 0`), and the page shows **"Off since \<day\>"** when that is before the current business day (S33). A manual Off also wins over every time window (S47). | An item switched off at closing would silently stay off at the next lunch service. The label lets the manager notice it during the morning stock count. | — |
| S31 | **Tax rate is resolved at bill close, not copied at order time.** An order line copies `tax_class_id` (D25 "tax class"), not `rate_bp`. 05 resolves the rate from `branchConfig()` at bill close; the rate may depend on the bill type (dine-in, takeaway, delivery) and the payment method (owner answer, v0.7; 05's rules, §4.4). Consequence: a rate change between order and bill applies to that open bill. 01a's snapshot keeps `tax_classes[].rate_bp` as the current rate; 05 may extend the tax class shape through a new snapshot schema version (S28). | Copying `rate_bp` at order time would bake in a rate that the bill type or payment method may change at bill close. | F §3.3 / D25 "subsequent menu changes apply only to future orders" — narrowed: a tax **rate** change applies to bills closed after it |
| S32 | **[ASSUMPTION, owner question 3] `out_of_stock_behaviour` per item:** `cook_fresh` (default: when available stock is 0 the full cook time applies, D7 / E1 stock AC5) or `sold_out` (when available stock is 0 the item cannot be ordered until a `StockSet` or `StockAdded` makes it > 0, which is how "someone makes it available again" for stock, S30; e.g. paye cannot be cooked in minutes, karahi can). Stored on `menu_items` and carried in the snapshot. Used only where the item is stock-tracked at that branch (§4.3); ignored elsewhere, with no validation error, because stock tracking is per-branch. 01a stores and delivers it; 02 and 03a act on it (§4.4). If the owner says every item is `cook_fresh`, the column stays with its default. | Without it, a sold-out paye would be offered with a full cook time no kitchen can meet. | D7 / E1 stock AC5 ("switches to full cook time when stock reaches 0") — narrowed for `sold_out` items, pending the owner's answer |
| S33 | **The business day is opened and closed by actions; it is open → closed (v1.0, review 2 B1, owner decision; replaces v0.7.1's date-free single command).** 05 owns shifts, the day open and the Z report; until 05, 01a adds two minimal hub commands. **`OpenBusinessDay {}`** (§6.18a) appends **`BusinessDayOpened { business_date, units }`** only when **no day is open** (none yet, or the last one is closed); while a day is open it is a no-op (`changed: false`, `reason: 'already_open'`), whatever the date or time, so a late service past midnight is never cut in two. **`CloseBusinessDay {}`** (§6.18b) appends **`BusinessDayClosed {}`** when a day is open; with none open it is a no-op (`reason: 'not_open'`); **minimum-gap guard:** a close of a day opened less than the branch setting **`day_min_gap_hours`** ago (default 4) is a no-op (`reason: 'opened_recently'`), so a second tablet answering the same prompt cannot close the day another tablet just opened (a hub clock moved backwards makes the age negative, which also counts as recent). Both events are `stream_type 'hub'`, branch_id; their `recorded_at` are the day's start and end; `business_date` is only a **label** (the hub's local date at the open, for display and 05's Z report), never a key, and `units` freezes each stock-tracked item's units for the day (S44). 05 later attaches the Z report and the shift close to `CloseBusinessDay` and keeps both events. **State:** the engine fold keeps `EngineState.business_day: { business_date, opened_at, closed_at \| null, units } \| null` (S15), so open/closed survives a restart and replay with no table. `openDayStartMs(state)` (`@pos/engine`) = `opened_at` while the day is open, else `null`; it is the `businessDayStartMs` every caller passes to `availableStock` (S41), so while no day is open, counts of items that do not carry over read 0. **Stock commands while no day is open → `409 BUSINESS_DAY_NOT_OPEN`** (§6.17, §6.17a); the stock page shows a large **Start day** action right there: one tap opens the day and the pending save is retried with the same `command_id` (§8.2). **Safety net for a forgotten close:** when a day has been open longer than the branch setting **`day_stale_after_hours`** (default 16), the stock query says `day_stale: true` and the stock page asks "Yesterday's day is still open since \<time\>. Close it and start a new day?" → `CloseBusinessDay` then `OpenBusinessDay`. Both settings are **data** (P2): columns on `branches`, carried in the snapshot, set by `set-branch-settings` in 01a and by 01b's branch settings endpoint later; before the first config the hub uses the column defaults (`DEFAULT_DAY_STALE_AFTER_HOURS = 16`, `DEFAULT_DAY_MIN_GAP_HOURS = 4` in `@pos/domain`). **`business_day_start_ms` and `businessDayStartedAt` stay removed** (v0.7): a clock-based start would make a forgotten close look like a valid day. Carried to 05 (§4.4). | A fixed 05:00 start is wrong for a restaurant that opens late or runs past midnight (P1). A date-based or open-only model gives no morning signal: after day 1 a day is always open, so yesterday's counts stay valid unless someone remembers to act (review 2 B1). A closed state makes the morning's first stock action hit Start day, and the stale prompt catches the night nobody closed. | — |
| S34 | **Tax is optional, per item and per branch.** (a) `menu_items.tax_class_id` is **nullable**: null means the item is never taxed. (b) `branches.tax_enabled BOOLEAN NOT NULL DEFAULT false`, carried in the snapshot. When it is false, 05 applies no tax at that branch whatever the items say. (c) Tax applies to a line only when the branch has `tax_enabled` **and** the line has a `tax_class_id`. Rules by bill type (dine-in, takeaway, delivery) and payment method are 05's (§4.4). (d) In 01a, `tax_enabled` is set only through the cloud CLI `set-branch-settings` (§6.7; `seed-tenant` leaves the default). The owner endpoint is 01b's branch settings. **Confirmed by the owner (v0.7): tax is optional.** | Many Pakistani restaurants charge no tax, some charge it only on card, and one branch may be registered while another is not. A required tax class would force a fake 0 % class on every item and could not express "this branch charges no tax". | **E0 menu AC8 "All items carry a tax class" — overridden**: the tax class is optional, and the branch flag can switch tax off |
| S35 | **Owner pages and `/admin/stock` are React entries in one Vite app, `apps/client`** (confirmed by the owner 2026-10-25, with the limits below). (a) **One app, one entry per surface.** `apps/client` (F §6.9) has one `package.json` and one `vite.config.ts`; each surface is an entry: `<entry>/index.html` → `src/features/…`. 01a has two: `owner` (`owner/index.html` → `src/features/owner/`, base `/owner/`, served by the cloud) and `admin-stock` (`admin-stock/index.html` → `src/features/admin/stock/`, base `/admin/stock/`, served by the hub). 02's ordering, cashier and KDS surfaces are added later as entries in the same way. **Each entry is its own Vite build** (`vite build --mode <entry>`, output `dist/<entry>/`), so the cloud never serves hub admin code and the hub never serves owner code (test 113). (b) Views inside an entry use hash routes (`/owner/#/menu`), handled by a small switch in `src/app/`. There is no router dependency, and the server needs no fallback route: it serves only the files in the build. (c) The cloud serves `apps/client/dist/owner/` under `/owner/*`; the hub serves `apps/client/dist/admin-stock/` under `/admin/stock/*` (§7.1). The build step and how each release ships the built files are S39 and §7.8. (d) **Styling is `packages/ui-kit` only.** `src/app/ui-kit.ts` imports `packages/ui-kit/tokens.css` and `packages/ui-kit/components/bundle.css` by relative path (the kit has no `package.json`, 00 M81); Vite bundles them and the fonts their `url()`s name. `apps/client` has no other stylesheet, no CSS framework, no CSS-in-JS and no `style` prop (ESLint, test 79). A style the kit lacks is added to `packages/ui-kit`, where 00's pages and 02 get it too, never to the app. `build.assetsInlineLimit: 0`, so every asset is a file under `assets/` and no `data:` URL meets the CSP of S21. (e) **XSS:** React escapes text. `dangerouslySetInnerHTML` is banned in `apps/client` (ESLint `no-restricted-syntax`, no plugin). The production build has no inline `<script>`, so the CSP of S21 stays as it is (test 15). (f) **Imports:** `apps/client` may import `@pos/domain` (root), `@pos/events`, `@pos/engine` (pure, workspace, no `node:*`; v0.6, so 02's clients use the same `availableStock` as the hub, S41), and CSS only from `packages/ui-kit`. It may not import `@pos/domain/hash` (it pulls in `node:crypto`, S27), `node:*`, anything under `apps/hub` / `apps/cloud`, or any other `.css` file (ESLint `no-restricted-imports`, test 79). (g) **Dependencies: a closed list, `apps/client` only** (versions checked 2026-10-25 on npm, pinned exactly in `apps/client/package.json`): runtime `react` 19.3.1, `react-dom` 19.3.1; dev `vite` 8.3.5 (Vitest 4.1.12 accepts `^8`), `jsdom` 30.1.3 (Vitest environment for component tests), `@types/react` 19.3.0, `@types/react-dom` 19.3.0. Nothing else: **no router, state, form or CSS library**, no React plugin, no testing library (tests render with `react-dom/client` and `act` from `react`). Adding any dependency to `apps/client` is a spec change. `jsdom` 30.1.3 needs Node ≥ 22.22.2, so dev machines and CI run Node 22.22.2 or later; the hub and cloud never run client code under Node. (h) **Hub `/admin/stock`: same choice; no concrete reason against was found.** Checked: bundle size (about 60 KB gzipped for React plus the page, over the LAN); it works with the internet down (hub-served, no CDN); R15 (no service worker, no secure-context API is needed); the admin login reuses 00's §8.2 endpoints with the shared `PinPad` and `StaffTiles` (i); deployment (built files ship with the hub release, S39). Cost accepted: 01a creates `apps/client` and its build, ahead of 02. (i) **Shared components for 02.** Components used by more than one entry, or built now for 02, live in `src/components/`. 01a builds `PinPad` and `StaffTiles` (the admin roster) for the `/admin/stock` login, plus `BusyButton` and `Banner` (§8.1 rules). They take data and callbacks as props and make no API calls, so 02's staff login and ordering screens reuse them unchanged with their own API client. (j) **Browser ULID (v0.6).** `Idempotency-Key` (§8.1) and `command_id` (§8.2, and every 02 command) are ULIDs made in the browser by one hand-written helper, `src/app/ulid.ts`: 48-bit `Date.now()` time plus 80 random bits from `crypto.getRandomValues`, Crockford base32, the same method as 00's `apps/hub/src/auth/pair-page.ts:207`. Not the `ulid` package (not on the closed list), and not `crypto.randomUUID`, which needs a secure context and the hub is plain HTTP on the LAN (R15). (k) **Browser-safe packages (v0.6.1).** `apps/client` imports `@pos/engine` and the root of `@pos/domain` (f), so neither may import a `node:*` module: no file under `packages/engine/**`, and no file under `packages/domain/src/**` except `src/hash.ts` (the `@pos/domain/hash` subpath, S27), imports `node:*`. Test files (`**/*.test.ts`) are exempt, as they never reach a browser. Enforced by an ESLint `no-restricted-imports` block for those paths (`{ group: ['node:*'] }`, repeating the root patterns, because a flat-config block replaces the rule's options), checked by test 127. A triple-slash `/// <reference types="node" />` is not an import and stays allowed in `hash.ts`. | One UI stack with 02, whose ordering, cashier and KDS clients are React in `apps/client` (stack table). The menu editor is the largest form in P1, and 02 needs the same PIN pad and staff tiles, so what 01a builds is kept, not rewritten (S20 removed). The limits keep the client to the stack table's React with nothing to learn or upgrade beside it, and one look (the UI kit) on 00's pages and the React pages. | F §6.9 `apps/client/src/` list: adds `components/` (additive). The entry `index.html` files and `vite.config.ts` sit at the package root, as in any Vite app |
| S36 | **Removed in v0.6.** v0.4–v0.5 resent the staff directory on an epoch change and applied it even when not newer, through a new `allowNotNewer` option on 00's `applyStaffDirectory` (a 00 v1.3 behaviour change). `restore-bump` (S42) raises `tenants.directory_version` instead, so M51 stays as it is and spec 00 needs no behaviour change. The number is kept so older references resolve. | — | — |
| S37 | **Superseded by S58 (v1.2): `GET /v1/admin/branches` is now 01a's.** Was: **`GET /v1/admin/branches` is 01b's (closes Q3).** 01b specifies it with the branch settings endpoint (§12.5). Until 01b ships, the owner app's branch picker shows the branch IDs from the JWT's `allowed_branch_ids`. | The owner pages work without branch names; 01b needs the list for staff-to-branch assignment anyway. | — |
| S38 | **Who counts stock is an assignable responsibility, 01b's (v0.7, owner answer; closes Q1).** 01b adds responsibilities that can be assigned to a person (e.g. stock counting for a station) and permission scopes; no behaviour is tied to a role name (§4.4). Until 01b, `manage-stock` plus `access-hub-admin` (S18) is the rule, and 01a builds no staff-session stock screen. | Building a head-cook stock screen in 01a would fix one restaurant's arrangement in code (P1, P2). | — |
| S39 | **Client build and release are part of 01a.** (a) **Build:** `pnpm --filter @pos/client build` runs `vite build --mode <entry>` for every entry (01a: `owner`, `admin-stock`), each into `apps/client/dist/<entry>/` (emptied first), with a Vite manifest at `dist/<entry>/.vite/manifest.json`. `dist/` is git-ignored; built files are never committed. The root `pnpm test` runs the build before Vitest, so a broken build fails the suite, and tests 15 and 113 read real output. (b) **Serving:** the hub and the cloud find the output relative to their own source, `new URL('../../../client/dist/<entry>/', import.meta.url)` in `apps/{hub,cloud}/src/lib/client-dist.ts`, the same rule as 00 M81 for the UI kit. It holds in a dev checkout, in the hub's `/opt/pos-hub` checkout and in the cloud's deploy directory. File list and bodies are read into memory at registration (§7.1), so replacing the files on disk changes nothing until the process restarts. (c) **Cloud release:** the deploy builds at the release commit (`pnpm install --frozen-lockfile`, `pnpm --filter @pos/client build`) before the new version starts; the build machine may hold dev dependencies. The release is done only when `GET /owner/` answers `200` with the CSP header (§7.8). (d) **Hub release (v0.6: on site, outside service hours):** the hub machine has no dev dependencies and no Vite. A hub release is done **on site, from a developer machine on the restaurant LAN, outside service hours**, in this order: **stop** the hub → move the `/opt/pos-hub` **checkout** to the release tag (the tag is pushed to the hub over `ssh` on the LAN, so the hub needs no git credentials) → `pnpm install --frozen-lockfile --prod` (the hub needs internet for the npm registry) → **ship** `apps/client/dist/admin-stock/`, **built on the developer machine from the same commit**, with `apps/hub/deploy/ship-client.sh` (00 M36 folder; `bash`, `git`, `tar`, `ssh` only) → **start** the hub. The hub is stopped while code and page change, so no restart (a power cut, `Restart=always`) can boot new code with the old page. Remote hub updates stay out of scope (README milestone C). Only the `admin-stock` entry is copied; owner code never reaches a hub. (e) **Same commit or nothing:** `ship-client.sh` refuses to copy when the local tree is dirty, the build output is missing, the hub service is still active, or the hub checkout's `git rev-parse HEAD` differs from the local one, so the stock page always matches the hub's routes. It writes to a staging folder and swaps it in with `mv`, so a broken copy never replaces a good one. A hub without the folder still boots and takes orders; the stock page answers `404` and boot logs an error (§7.1), which the release check in §7.8 catches. | Without a defined build and copy step (plan review #18), a hub would run with no stock page, or with a page built from another commit that calls routes the hub does not have, and nothing in the release would notice. Building on the developer machine keeps Vite and dev dependencies off restaurant hardware (S35, F §1 deployment row). No spec defines remote access to a hub on mobile data, and a release during service would stop order taking (F §6.8 schedules upgrades outside service hours). | — (adds `ship-client.sh` to 00 M36's `apps/hub/deploy/`) |
| S40 | **Plan-review decisions (2026-10-25), from the implementation plan's "Needs spec change" list.** N1 `packages/domain` gets `@types/node` 22.19.1 as a dev dependency, for `hash.ts` only (S27, §12.1). N2 `onBranchConfigApplied(prev, next, tx)` passes the applying transaction, so 03a/03b append their reaction events in it (§4.2). N3 `bumpConfigVersion` reads, locks and updates `branches` through `TenantLevelRepository`: an allowed D54 exception, because S8's tenant-wide bump must reach every branch, not only the JWT's (§5.2). N4 a poll skipped because the hub is not provisioned or not confirmed has its own outcome `not_ready`, makes no HTTP call, and config status shows "Waiting for hub confirmation" (§3.4 step 1, §6.21, §8.2). N5 (removed in v0.6 with `pull-now`, S24). N6 S25's version edit is line 8. N7 money input drops every comma before parsing (§8.1, test 74). N8 `SetPrecookedStock`'s result `set_at` may differ by milliseconds from the stored `recorded_at`; the stock query is the source of truth (§6.17). N9 `QueryCtx.config` is named `QueryCtx.branchConfig` (S16). N10 §7.5 targets are checked by the runbook and the hub smoke script, not by automated tests. N11 (v0.6: test 102's page part covers the danger banner only) tests 75, 102, 103 and 104 each have a server (or render) part and a page part. **Both parts are automated:** the numbered test covers the first part, and a component or lint test cited `[01a §10 #n page part]` covers the page part, so each number is still cited by exactly one test. The page parts are **also** runbook steps in §11 step 29. The label **Runbook only** marks a check that has no automated test; none of these four has one. (v0.7: 104 is removed; 132, 133 and 139 follow the same rule.) N12 the first boot after migration 0004 replays the full log once (§7.6). | The implementation plan found these gaps against the code (`docs/reviews/01a_plan_review.md`); each is decided here so the plan does not diverge from the spec. | §4.2 `onBranchConfigApplied` signature (N2); D54 for `bumpConfigVersion` only (N3) |
| S41 | **A stock count is valid for one business day, unless the item carries over (v0.7, owner answer; resolves the v0.6 assumption per item).** Each item has **`carries_over`** (boolean, default `false`). `@pos/engine` exports `countIsValid(entry, businessDayStartMs, item)`: false when `set_at` is null, or when the entry's `unit` ≠ the item's stock unit for the day (`dayUnits`, S44; a unit change takes effect at the next day open), or when `item.carries_over` is false and (`businessDayStartMs` is null or `set_at < businessDayStartMs`); true otherwise. `availableStock(state, itemId, businessDayStartMs, item)` returns **0 when the count is not valid** and `max(0, on_hand − reserved)` otherwise; `item` is the snapshot item (`carries_over`, and its stock unit for the day: `dayUnits(state, item).stock_unit`, S44), and `businessDayStartMs` is `openDayStartMs(state)`: the open day's `opened_at`, or `null` while no day is open (v1.0, S33), so between a close and the next open only items that carry over show stock. The engine stays pure: the caller passes the start and the item. These two functions are the **only** place the rule lives: the hub's SubmitOrder (02/03a), the stock commands (§6.17, §6.17a), the stock query (§6.19), the catch-up `stock` part (§4.5) and 02's clients (S35 f) all call them. There is no day-close `StockSet`. | Without it, yesterday's closing count (e.g. 4 karahis thrown away at closing) would show as "4 left" at the next lunch and get stock-time ETAs for food that does not exist (E1 stock AC1 "at the start of service", AC6 "no count → 0"); and an item that keeps (bottled drinks, frozen kebabs) would have to be re-counted every morning. | — |
| S42 | **Cloud CLI `restore-bump` after any cloud restore (replaces S29 a/b and S36).** `pnpm --filter cloud restore-bump --tenant <tenant_id>` (`apps/cloud/src/cli/restore-bump.ts`, `SystemContext`, M56) runs in one transaction: `UPDATE branches SET config_version = GREATEST(config_version + 1, $now_ms) WHERE tenant_id = $1` and `UPDATE tenants SET directory_version = GREATEST(directory_version + 1, $now_ms) WHERE tenant_id = $1`, with `$now_ms` the cloud's Unix ms. It prints each old and new version. It changes no config data, so it writes no `config_audit` row (S26). **Why it works:** every version only grows by 1 per write, so no pre-restore value can be near the current Unix ms (≈ 1.76 × 10¹²); a later restore gets a later `$now_ms`, so the rule holds again. Values stay below 2⁵³ (`z.number().int()` on the hub; `BIGINT` on the cloud; `INTEGER` in SQLite). The forward-only rules (§3.4 step 4, 00 M51) and spec 00 stay unchanged. **Must run after any cloud database restore or reseed, before hubs poll again** (requirement on 06 and the ops runbook, §4.4). **Consequence, for the restore runbook:** the restored directory is the backup's, so staff removed or PIN-reset after the backup come back on every hub (with the old PIN) until the owner removes or resets them again; the runbook lists those changes from 01b's audit trail and re-applies them right after `restore-bump`. | A cloud restore from yesterday's backup moves `config_version` back (e.g. 50 → 40) and `directory_version` back (35 → 30); every hub would ignore every snapshot and directory as "not newer", silently serving a menu and staff list the cloud no longer has. One CLI and no version comparison change does what the epoch, the directory resend and the 00 v1.3 change did. | — |
| S43 | **A failed apply is visible, and each part is retried alone (review 1 B2).** Step 5 of §3.4 runs the config part, the directory part and every `onBranchConfigApplied` hook in one `writer.run`. If that transaction throws (a hook, `applyStaffDirectory`, a projection, the disk), the poller: (a) records `last_problem { outcome: 'rejected', reason: 'apply_failed', at }`, logged at `error` with the error's message (never the body or the directory, §7.3); (b) retries **each part alone**, the directory part first, each in its own `writer.run`, so a staff removal (R14, M50, M38) never waits on a menu apply and a bad directory never blocks the menu. A part that fails again stays unapplied and is retried on the next poll; `last_problem` stays until a poll applies the config part or is `unchanged`. A hook that throws therefore never commits half a reaction. | A hook from 03a or 03b that throws for one config, or a directory row 00 cannot apply, would roll back both parts every 60 s with no outcome, no banner and no staff revokes. | §4.2 `onBranchConfigApplied` (failure semantics added) |
| S44 | **Units (v0.7, owner answer).** Each item has **`stock_unit`** and **`sale_unit`**, each ∈ `piece` (default), `g`, `ml`. Every quantity and every stock number is an **integer in the smallest unit** (pieces, grams, millilitres): `on_hand`, `reserved`, `StockSet.on_hand`, `StockAdded.quantity`, `low_stock_threshold`, and 02's order quantities (in `sale_unit`). The UI shows and accepts kg and L (up to 3 decimals) through one browser-safe helper pair in the `@pos/domain` root, `parseQuantity(text, unit)` / `formatQuantity(n, unit)` (`packages/domain/src/units.ts`). **Decided here (needed for the two units to work together):** when the units differ, `sale_unit` must be `piece` and **`stock_per_sale_unit`** (integer 1 … 1 000 000) says how many stock units one piece uses (a plate of karahi from a pot counted in grams: `stock_unit 'g'`, `sale_unit 'piece'`, `stock_per_sale_unit 250`); when they are equal it must be 1. 03a reserves `quantity × stock_per_sale_unit` stock units per order line, and the ordering screen shows `floor(available ÷ stock_per_sale_unit)` pieces left (`saleUnitsAvailable` in `@pos/engine`). `price_minor` is the price of one piece, one kg (1 000 g) or one L (1 000 ml) of `sale_unit`; line arithmetic and rounding for g/ml are 02's and 05's (§4.4). Each `StockSet` records the `unit` it was counted in; a count in another unit than the day's stock unit is not valid (S41), so a unit change asks for a new count instead of reading 4 pieces as 4 g. **Units are frozen for the open day (v1.0, review 2 S-2, owner decision):** a new snapshot that changes an item's `stock_unit`, `sale_unit` or `stock_per_sale_unit` takes effect at the **next `OpenBusinessDay`**; the open day keeps the old units and count. `BusinessDayOpened.units` records `{ stock_unit, sale_unit, stock_per_sale_unit }` for every stock-tracked item at the open, and `dayUnits(state, item)` (`@pos/engine`) returns that entry, or the item's own fields for an item not in it (new since the open, or no day open). Every stock path uses `dayUnits`: the stock commands (the `unit` they write), `countIsValid`, the stock query, 02's order quantity and reservation, and 03a. So `on_hand` and `reserved` are never in two units within a day. Reserve, release and hand-over use the order line's **copied** `stock_per_sale_unit` (§4.4 02, D25), which is the day's. | A pot of karahi is weighed, a bottle is a piece, a weighed BBQ item is sold by the kg. One integer unit per number keeps the arithmetic exact (like money in `_minor`, D47). | — |
| S45 | **Stock adds: `StockAdded { item_id, quantity, unit }` (v0.7, owner answer).** "This much more is ready", next to `StockSet` (a physical count). **New hub command `AddPrecookedStock`** (§6.17a), not an extension of `SetPrecookedStock`: each command records one kind of fact and has its own result, and the manager's two buttons ("Save counts", "Add") map to one command each. For each entry, inside the transaction: if the item's current count is valid (`countIsValid`, S41), append `StockAdded` (`on_hand += quantity`; `set_at` is unchanged, because an add is not a count); **otherwise append `StockSet { on_hand: quantity }`**, because adding to a count that no longer counts (yesterday's, never counted, another unit) means "there are now exactly this many". *⚠️ Changed by 03a v1.0 (A-19, A-14):* `StockAdded` v2 (01c V5 schema) gains an optional `reason?: 'moved'`, additive within v2; absent = a manual add. 03a's move to stock writes `reason: 'moved'` (foundation v1.9 F-18). After a `StockAdded` from `AddPrecookedStock`, the command appends 03a's `StockReserved` drafts for waiting lines (03a §3.7). | Without adds, a cook bringing out 10 more kebabs must count the whole tray again, and two people saving counts at once would overwrite each other's batch; an add commutes with reservations and other adds. | — |
| S46 | **Low-stock threshold and a derived low/out level (v0.7, owner answer).** Each item has **`low_stock_threshold`** (integer in `stock_unit`, nullable = no low alert). **v1.0.2 (owner ruling):** the threshold is stored with its unit: it is in the item's own `stock_unit`, on the same row. While a day is open whose frozen `stock_unit` for the item (`dayUnits`, S44) differs from the item's `stock_unit`, the threshold does not apply and `stockLevel` gives no `low` (it still gives `out` at 0 and `not_counted`); the alert resumes at the next day open, which freezes the new unit (test 157). `stockLevel(state, itemId, businessDayStartMs, item)` in `@pos/engine` returns `not_counted` (count not valid, S41), `out` (available 0), `low` (threshold not null and available ≤ threshold) or `ok`. **Mechanism: derived, no event.** The level is computed wherever stock is shown, from the stock events every staff client already receives (§4.5); nothing is stored or pushed beyond them, and replay needs no new fold. **Audience:** people whose permissions include `manage-stock`. In 01a that is the `/admin/stock` page (it requires `manage-stock`): an alert bar lists the `low` and `out` items. **`out` covers every stock-tracked item at 0, `cook_fresh` included** (the owner's answer: "reaches 0"), because the stock-time ETA is gone; the bar shows `out` items after the `low` ones (review 2 nit 7). **Known limit in 01a (review 2 nit 6):** the admin session behind `/admin/stock` idles out because its poll is not activity (00 M59), so during service the alert is seen only by someone who has the page open and logged in; staff see it from 02 on. **Known limit (nit 8):** `low_stock_threshold` is tenant-wide while stock is per branch, so a small and a large branch share one threshold; a per-branch threshold waits for an owner request (P1). 02's staff clients show the same alert only to a session whose effective permissions include `manage-stock` (R5; §4.4). | An alert event would duplicate what `StockSet` / `StockAdded` / `StockReserved` already say and need its own replay rules; per-permission filtering of a push needs a WS change 00 does not have. | — |
| S47 | **Time windows per item and per category (v0.7, owner answer).** An item and a category may each have up to 4 **availability windows** `{ start_ms, end_ms }` (local time of day in ms, multiples of 60 000, 0 … 86 340 000, `start_ms ≠ end_ms`; `end_ms < start_ms` wraps past midnight; the window is `[start, end)`), stored as rows (P2) and carried in the snapshot. No windows = always. `inAvailabilityWindows(windows, localTimeOfDayMs)` and `localTimeOfDayMs(nowMs, utcOffsetMs)` live in the `@pos/domain` root (browser-safe); the offset is always passed, never read from the runtime (review 2 S-4). **Hub time (v1.0):** the hub publishes `hub_time: { now_ms, utc_offset_ms }` (its clock and its OS time zone's offset at that instant) in the catch-up `branch_config` part (§4.5), in `GET /queries/branch-config` (§6.23) and in the stock query (§6.19). Clients compute the hub's now as `now_ms + (performance.now() − the performance.now() at receipt)` and evaluate windows with the hub's offset, **never the device's wall clock or time zone**, and re-evaluate each minute, because a boundary emits no event (§4.4 02). An item is **orderable by time** when it is inside its own windows (if any) **and** inside its category's windows (if any), evaluated against the **hub clock** in the hub's time zone; the hub is the authority (02's SubmitOrder refuses an item outside its windows). **A manual Off always wins** (S30): a window never makes an Off item available. **[ASSUMPTION, owner question 12] A manual On does not override a window** (to sell breakfast late, the owner edits the window); decided in v0.7 without an owner answer, isolated in §12.7. **Days of week are not built** (the owner asked for time windows; deferred, §12.4). | Breakfast items offered at dinner, or switched on and off by hand twice a day. | **E0 availability AC4 narrowed** (time of day only, no days of week); **E0 availability AC5 overridden** (a manual toggle does not hand back to the schedule at the next boundary; Off always wins, On never overrides a window) |
| S48 | **Menu size is not bounded by design; the design size is 5 000 items (v0.7, owner answer).** (a) The owner menu read (§6.11) has search and cursor pagination. (b) The snapshot stays whole (S3): at 5 000 items routed to one branch it is about 2.5 MB of JSON. The cloud **gzips** the `/v1/sync/config` `200` with `node:zlib` when the request sends `Accept-Encoding: gzip` (no new dependency; Node's `fetch` sends it and decompresses), about 300 KB on the wire; the hash is over the parsed JSON (S27), so compression does not touch it. Both paths send the bytes of `JSON.stringify({ data })` built from the same `wire` object; the gzip path sends them as a `Buffer`, which Fastify does not pass through the response serializer, so the plain and the decompressed bodies are identical (review 2 nit 2). The poll timeout for a `200` is 30 s (§3.4). (c) Bandwidth: 1 440 `304`s a day stay ≈ 1 MB/day; each menu change at 5 000 items costs ≈ 300 KB, so 5 changes a day ≈ 1.5 MB/day. (d) Hub cost: hash and Zod parse run **before** `writer.run`, so the writer is held only for the insert, the append and the projection (§7.5). They still run on the hub's one Node thread, so a very large menu pauses every request and WS frame while it is parsed; moving that work off the main thread (a `worker_threads` worker) is **deferred with a trigger: any branch snapshot over 1 000 items** (§12.4, review 2 S-5). The stock page's 15 s poll reads only stock numbers and flags, not the config, and is short-circuited by versions (§6.19). (e) `config_snapshots` grows ≈ 2.5 MB per change at 5 000 items (≈ 4.5 GB/year at 5 changes a day), which reaches the §12.4 pruning trigger in months, not years, for such a menu; the pilot menu stays near 110 MB/year. | A fixed bound in code (v0.6's "< 1 000 items") would fail for the next restaurant (P1); without gzip a 2.5 MB snapshot over mobile data could time out every poll. | — |
| S49 | **Urdu on the 01a pages (v1.1, amends §8.3).** `src/i18n/` holds `en.ts` and `ur.ts` with the same keys; a key missing from `ur.ts` falls back to English, and the list of missing keys is kept in `docs/design/handoff/01a/urdu-todo.md`. Both entries pick the language once on load exactly as 00 M83: `?lang=en\|ur` if present (stored in `localStorage` key `pos-lang`), else the stored value, else `ur` when `navigator.language` starts with `ur`, else `en`; then they set `lang` and `dir` (`rtl` for Urdu) on `<html>`. On the hub origin the stock page and the 00 pages share the stored choice. **Type classes (review 3 S-4):** as 00 does (`apps/hub/src/lib/page.ts`), the Latin type classes `display`, `title`, `heading`, `body-lg`, `body` and `caption` map to the kit's `ur-*` classes in Urdu, through one helper in `src/i18n/`, so Nastaliq gets its face and line height. Prices, quantities, times, IDs, PINs and table names stay LTR (`.pos-ltr`, mono classes); digits stay Latin. Placeholders such as `{name}` are filled by the existing `fill()` in both languages. | D12 asks for keys and the design system requires Urdu RTL; one rule for every hub-served page. | §8.3 (English only) |
| S50 | **Owner app shell, dialogs and texts (v1.1).** (a) **Shell:** a side menu (Menu · Floors and tables · Kitchen stations; foot: the user's `display_name` and **Sign out**). *Changed in v1.3.1 (P-4 answer B; replaces the v1.1 bottom tab bar):* at phone width (≤ 760 px) there is no bottom tab bar; a **Menu** button in the app bar opens the side menu as an overlay built on the kit `Dialog` (`role="dialog"`, Escape closes it, focus is trapped inside it and returns to **Menu** when it closes), and **Change password** (01b §6.11) and **Sign out** are reachable from it. The overlay shows the same entries as the desktop side menu. Selecting a menu item closes the overlay and navigates to it. Login returns no restaurant name or email, so neither is shown. **Sign out** sends the existing `POST /v1/auth/logout` (best effort; a failure is ignored), then clears `sessionStorage` and shows login. The logout body is built when the request is sent, **after** any refresh the call makes, so it carries the refresh token current at that moment (review 3 S-5: a refresh rotates it, 00 M49). (b) **Archive:** an item, category, station, tax class or floor is archived only after a confirm dialog that names it ("Archive Paye?"); a table or a batch program is archived at once and shows an **Archived · Undo** chip for 8 s (Undo sends `archived: false`). While the cloud-unreachable banner shows (S53), the chip stays until the banner clears. An Undo answered `409 CONFIG_NAME_TAKEN` (§6.4 checks names on restore) replaces the chip with the name-taken text; the row stays archived. A `409 CONFIG_IN_USE` (§6.4, §6.9, §6.10, §6.12, §6.13) shows a blocked dialog with the reason and a way forward instead of an Archive button: "{name} can't be archived yet" for an archive, "The cooking type can't change while items use {name}" for a §6.9 station type change. The names in `used_by.ids` are tables from the loaded floors, or items resolved from one `GET /v1/admin/menu?limit=200` (unresolved ids show as "and N more"; §12.7). A category with active items therefore cannot be archived from the page; it shows the blocked dialog. (c) **Discard:** Cancel, Back, a side menu item, the app-bar branch select (S52) or **Sign out** on a form with unsaved changes asks "Discard your changes to {name}?" naming the changed fields (**Keep editing** primary, **Discard changes**); an unchanged form leaves at once. (d) **Saved:** after a save the page shows a **Saved** chip for 3 s near what changed (no silent save). (e) **Errors:** every code goes through `errors.<CODE>` keys; `CONFIG_REFERENCE_INVALID` has one text per `details.reason`; a code without a key shows `errors.UNKNOWN`; the page never shows a code or a server message. (f) **Numbers the API does not give are not shown:** no floor or station counts on the branch picker (01b), no item total on the Items tab until `next_cursor` is null, no item counts per category or tax class. (g) **Item on a phone:** a price-first layout (price, tax, then Kitchen and Hours rows with Edit, then **Save price**); "On sale at {n} of {m} branches" is a read-only line from the item's routes, not a switch. (h) **Partial save (B03):** when an item edit's `PATCH` succeeds and a branch's `PUT …/routes/:branch_id` (§6.16) fails, the page shows "Item saved. One branch was not." with the reason and **Save {branch} again**, which re-sends only the failed `PUT`s. | The hand-off's frames; one archive rule (Q2); a category with items is refused by §6.13, so the frame that archives one with items is not built. v1.3.1: the phone shell follows the 01b hand-off frame `StaffPhoneList.html` (P-4 answer B). | — |
| S51 | **Bulk add tables in the page (v1.1).** The Floors page and the first-floor form take a name range (prefix + first and last number, e.g. T1 … T12, at most 100 tables) and optional seats per table, and send one §6.5 `POST` per table, in order. **Before the first `POST`** the page checks every name against the branch's loaded floors (§6.2, archived included) and refuses the range if any name is taken, naming them ("T5 is already used at {branch}"); no request is sent. The `Idempotency-Key` of the table at index *i* is the form's key (one ULID per form open, S35 j) with its 80-bit random part increased by *i* modulo 2^80 (the time part never changes, so the key stays a valid ULID). The form key renews when **any** input that goes into a request changes: range, seats, floor or branch; so a key is never re-sent with another body (S7). The branch select (S52) is disabled while the loop runs. The button shows "Adding {i} of {n}…"; the loop stops at the first error and names it; tables already added stay. **Add** again (same inputs, same keys) resumes from the failed table: a create that committed but lost its answer replays (S7). After the floor list reloads, names now present are skipped, not re-sent. No endpoint (§12.4 keeps a bulk endpoint deferred). | First setup drops from about 36 actions to 6 (Q1). | — |
| S52 | **Branch choice (v1.1).** With one allowed branch the picker is skipped. The chosen branch is kept in `sessionStorage` key `owner_branch_id` (ignored if it is not in `allowed_branch_ids`, cleared on sign out); the Floors and Stations app bars have a branch select. `#/menu` needs no branch (the menu is tenant-wide); inside the item form the Kitchen section lists every allowed branch, one row each. Branches show as `…` + the last 4 characters of the ID until 01b names them. | A reload no longer loses the branch (Q8); the menu is the same for every branch (Q7). | — |
| S53 | **Cloud unreachable (v1.1, review 3 B1).** A network failure shows one warn banner on every owner view ("Can't reach the restaurant cloud — retrying…"); typed values stay. While it shows, save buttons are disabled. The page then **probes** on a backoff of 0.5 s, doubling to at most 5 s: after a failed read it repeats that read; after a failed write it sends the current view's own read (§6.2, §6.8, or §6.11 with `limit=1`), whose answer never replaces values in an open form. A failed write is never re-sent by itself. The first successful call clears the banner and enables Save again; the user taps Save, which re-sends with the form's same `Idempotency-Key` (S35 j) or as a `PATCH` that is a no-op if it already landed (S26). On `#/login` (no token, so nothing to probe) **Sign in** stays enabled with the banner, and a tap retries. | §8.1 "banner and keep the form", made concrete, with a way out of the banner. | — |
| S54 | **Stock page layout and wording (v1.1, amends the §8.2 texts).** (a) **Words:** the count input is **Count** with a **Still right** button (was "Confirm"); "Available" becomes **Left to sell**, "Reserved" becomes **on orders**, the toggle is the **Selling On / Off** switch (`role="switch"`); "Set at 11:05" becomes "Counted 11:05" ("Counted last night 23:10" before the open day's start). The stale-day buttons are **Close it and start today** and **Keep it open**. (b) **Filters:** a level filter (To count · Low or out · Off · All, each with its count) next to the search box and the category filter; the low/out bar shows one chip per item, and a tap scrolls to and focuses its row. (c) **Add:** inline on a tablet; on a phone a bottom sheet with quick chips +5, +10, +20, +50 in the display unit (pieces, kg or L; sent in the stock unit, S44). (d) **Sign-in:** the roster is shown as `/admin/login-roster` returns it; an empty roster shows "No one here can count stock"; a locked tile shows "Locked · {n} min" rounded up from `locked_until` against the **device clock**, display only (the roster has no `hub_time`, the hub enforces the lock; as 00 does); `PIN_LOCKED_OUT` and `DEVICE_LOCKED_OUT` show minutes rounded up from `retry_after_ms`; `PIN_INVALID` shows `attempts_remaining` when ≤ 2; a network failure shows **Retry now**. A signed-in admin without `manage-stock` sees the `errors.PERMISSION_DENIED` text. (e) **Header:** day chip, menu status chip (§6.21), "Signed in as {name}" and **Sign out** (sends the existing `POST /admin/auth/logout`, then shows the roster), **Close day**. **Sign out** with touched rows first asks "Save, keep on this tablet, or discard?" (S55). (f) **Hub admin shell:** from tablet width the page draws the 00-S20 side menu (00 M86): brand = `…` + the last 4 characters of `branch_id` from §6.21 (the stock answers carry no branch name), links to `/admin#devices`, `#sessions`, `#lockouts`, Stock as `aria-current`; at phone width it keeps its own app bar. (g) **Shared admin session (review 3 B2):** the stock page uses 00's `sessionStorage` keys. On login it writes `admin_session_token`, `admin_staff_id`, `admin_name` (`display_name`) and `admin_permissions` (00 M89), as `/admin` does; the header name comes from `admin_name`, so a session started on `/admin` shows its name; **Sign out** and any signed-out answer (`ADMIN_SESSION_REQUIRED`) remove all five 00 keys (`admin_bootstrap` included). (h) **Feedback lines:** while the hub is unreachable the action bar reads "{n} counts waiting" (B16); after a save it reads "{n} counts saved at {time}" (B17). | The design hand-off; a shared tablet must not show or save under the last person's name (Q3). | §8.2 text |
| S55 | **Typed counts survive an idle sign-out (v1.1, review 3 B3, S-3).** While a day is open, each edit (a typed count, **Still right**, or S56's confirm-all) writes the touched rows to `localStorage` key `stock-draft:<branch_id>:<opened_at>:<staff_id>` (`branch_id` from §6.21; `opened_at` of the open day, because `business_date` is only a label, S33; `staff_id` from `admin_staff_id` when the edit is made) as `{ saved_at, entries: [{ item_id, on_hand, unit, base_set_at }] }`, where `base_set_at` is the row's `set_at` when the value was typed. With no day open nothing is written (the typed values live in the page only). When the **same** staff member signs in again while the **same** day (`opened_at`) is open, entries come back as touched with the banner "Your {n} unsaved counts from {time} are back" (`saved_at` from the hub clock estimate, `src/app/hub-clock.ts`), except: an entry whose item is not in `items_meta` or not stock-tracked, or whose `unit` is not the day's unit, is dropped; an entry whose current `set_at` differs from `base_set_at` (someone saved or added since) is **not** restored as touched and is listed as "Changed since: {item} (now {value})". The draft is deleted on a successful save, on **Discard**, and on load for every other `opened_at` of this branch. Another person signing in does not see it. An explicit **Sign out** with touched rows asks Save / Keep on this tablet / Discard (S54 e). A storage error is ignored (the page works without it). | A manager signed out for being idle loses no typed counts (Q4), and a kept count never overwrites a newer one. | — |
| S56 | **"All N are still right" (v1.1).** Carried-over rows are stock-tracked rows with a valid count whose `set_at` is before `business_day_started_at`. While at least one is not yet touched, a callout "{n} counts from last night" offers **All {n} are still right**: it marks every untouched carried-over row as confirmed with its shown `on_hand` (rows the user already typed keep the typed value) and sends one **Save counts** (§8.2). No new command. **Large saves (review 3 S-2):** any Save counts with more than 200 touched rows (§6.17's limit) is sent as consecutive `SetPrecookedStock` commands of at most 200 rows in config order, each with its own `command_id` kept for its retry (D32); the loop stops at the first failure and keeps the unsent rows touched. | The morning count drops from about 45 taps to about 20 (Q5). | — |
| S57 | **Per-branch price (v1.2, owner answer Q6.5; replaces the S11 "same prices at every branch" assumption).** The menu stays tenant-wide, but a branch may sell an item at its own price. (a) **Storage:** `item_routes.price_minor_override BIGINT NULL` (cloud migration `0004_branch_price.sql`); null = the item's `price_minor`; same range as `price_minor` (§3.3). It sits on the route because only a branch that sells the item has a price there; removing the route removes the override. (b) **API:** §6.14 `routes[]` and the §6.16 body take `price_minor_override?` (default null); `{ station_id: null }` with a non-null override → `400 VALIDATION_FAILED`. Every route in a response (§6.11, §6.14–§6.16) carries `price_minor_override`. (c) **Snapshot:** `items[].price_minor` is the branch's **effective price**, `COALESCE(price_minor_override, price_minor)`; no new snapshot field, so the hub, 02 and 05 read one price and need no change, and an open order keeps the price it copied (D25). (d) **Audit:** the route's `before` / `after` include `price_minor_override`, so an override change is one `item_route` / `route_set` row at that branch (a price edit there); a PUT that changes nothing writes nothing (S26). It bumps that branch only. (e) **Owner app (§8.1):** the item form's **Branches and kitchen** section has one row per allowed branch with **Price here** (rupees through `money.ts`; empty = main price, placeholder "Same: {price}"; disabled when Not sold here); a bad value marks that branch row before sending, and a refused PUT marks that row (B03). The menu list shows a chip "{branch} Rs {price}" for each allowed branch with an override. | One price per item in the snapshot keeps 02 and 05 unchanged; a price list entity (P2) is more than the pilot needs. | S11 assumption (§12.7) |
| S58 | **Branch names in the owner app; `GET /v1/admin/branches` moves from 01b to 01a (v1.2, owner decision; supersedes S37).** §6.7b returns `{ branches: [{ branch_id, name, status }] }` for the JWT's `allowed_branch_ids`, ordered by name, then id; 1 statement; read, no audit. The owner app loads it once after login and shows the branch **name** on the branch picker, the branch selects and every text that names a branch (partial save, name taken, blocked dialogs). Until it answers, or when it fails, the ID tail shows ("…P0AB"), and the failure is handled like any read (S53). 01b still owns the branch settings `PATCH` (§12.5). | The pilot owner asked for names; the branch name exists since 00 (`branches.name`), so the read is one statement. | S37 |
| S59 | **Lines sold by weight or volume (v1.2, owner answer Q6.13; resolves the [ASSUMPTION]).** A g / ml line is weighed to **50 g / 50 ml** (0.05 kg / 0.05 L; 02's quantity input) and priced to the **nearest whole rupee**: `lineTotalMinor` for `g` / `ml` is `price_minor × quantity / 1000` rounded half-up to a multiple of **100 minor units**, per line; `piece` lines are unchanged. The bill shows the weight ("Chicken Karahi 1.25 kg × Rs 2,200 = Rs 2,750"); 05 applies it and 02 uses the same function for the order line. | One function, so the order line and the bill never disagree. | §4.2 assumption |
| S60 | **01b Staff & Roles v1.0 changes this spec as listed in 01b §4.4** (rows 1–16). Each changed section carries a "Changed by 01b" marker. 01b owns cloud migration `0005_staff_roles.sql`, which also changes this spec's `branches` and `config_audit` CHECKs; `0002` is merged and unchanged. | One package for the owner to approve; later modules read 01a and find the current contract. | §5.2 CHECKs (01b B16, B21) |
| S61 | **01c Menu v1.0 changes this spec as listed in 01c §4.5** (rows A1–A18; breaking, 01c V1). Each changed section carries a "Changed by 01c v1.0" marker. 01c owns cloud migration `0006_menu_variants.sql`, which deprecates the item unit fields and `group_label` and widens the `config_audit` CHECKs; `0002` is merged and unchanged. | One package for the developer to approve; later modules read 01a and find the current contract. | §3.3, §4.2–§4.5, §5.2, §6, §8, §9, §10 (01c §4.5) |


> ⚠️ Changed by 01b (B11, B21): S8 adds the directory-write lock order (`tenants … FOR NO KEY UPDATE`) and corrects "config writes never lock `tenants`" (FK key-share locks); S26 lists 01b's audit entities and actions; S60 records the package. See 01b §4.4.

> ⚠️ Changed by 01c v1.0 (A1, A2, A3, A17): **S12:** variants, modifiers and deals are specified in 01c v1.0; `group_label` is replaced by variant groups (V2). **S14, S41, S44, S45, S46:** stock is keyed by **stock item** (`EngineState.stock[stock_item_id]`); `stock_unit` and `carries_over` live on `stock_items`, `low_stock_threshold` on `stock_item_branches`; `stock_per_sale_unit` → `stock_draws.quantity_per_sale_unit`; `StockSet` / `StockAdded` v2; **the tracked rule changes** (V12): a route with a stock time or stock program no longer tracks an item on its own, it also needs a stock draw to a stock item counted at the branch. **S28:** snapshot schema 2 replaces schema 1 (a new version; S28 c not used, V1). **S59:** `menu_items.requires_weighing` (V18): a g/ml line may have its weight pending (`quantity` and `line_total_minor` null until 02's weight command). S61 records the package. See 01c §4.5.

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
| `price_minor` integer 0 … 1 000 000 000 minor units; zero allowed (v1.0: written in minor units, not a currency, P1). v1.2: a route's `price_minor_override` is null or in the same range (S57); a removed route (`station_id: null`) has none | `400 VALIDATION_FAILED` |
| Branch settings (S33): `day_stale_after_hours` integer 1 … 72 (default 16); `day_min_gap_hours` integer 0 … 24 (default 4); **`day_stale_after_hours > day_min_gap_hours`**, checked on the merged row (otherwise the stale prompt's close would be refused as `opened_recently` and the prompt would return on every poll) | `400` (CLI: exit 1) |
| `cook_time_ms` 1 … 14 400 000 (4 h); `prep_buffer_ms` 0 … 3 600 000; `stock_time_ms` null or 0 … `cook_time_ms` (0 = served from stock with no station wait, E1 edge case) | `400` / `422 CONFIG_REFERENCE_INVALID` (stock > cook) |
| `rate_bp` integer 0 … 10 000 (basis points; 1 600 = 16 %) | `400` |
| Station: `capacity` 1 … 100; `freshness_window_ms` only for `batch` (0 … 3 600 000, default 0, D17); `completion_mode` ∈ `two_tap` (default), `single_tap`, `auto_done` | `400` |
| Route: station belongs to the branch and is active; slot station → `program_id` and `stock_program_id` null; batch station → `program_id` required, both programs active and on that station | `422 CONFIG_REFERENCE_INVALID` |
| Item references an active category, and an active tax class **when `tax_class_id` is not null** (null = never taxed, S34); table references an active floor of the same branch | `422 CONFIG_REFERENCE_INVALID` |
| `out_of_stock_behaviour` ∈ `cook_fresh` (default), `sold_out` (S32) | `400` |
| `stock_unit`, `sale_unit` ∈ `piece` (default), `g`, `ml`; units equal → `stock_per_sale_unit` = 1; units differ → `sale_unit` = `piece` and `stock_per_sale_unit` 1 … 1 000 000 (S44) | `400` |
| `low_stock_threshold` null or integer 0 … 1 000 000 (S46); `carries_over` boolean, default `false` (S41) | `400` |
| `availability_windows` (item and category): 0–4 entries, each `start_ms`, `end_ms` integers 0 … 86 340 000, multiples of 60 000, `start_ms ≠ end_ms`; sorted by `start_ms`, `end_ms`, `window_id` in every response and in the snapshot (S47, review 2 nit 4) | `400` |
| **PATCH rules run on the merged row (v0.6):** every rule above is checked on the stored row with the PATCH fields applied, inside the transaction after the row lock (e.g. lowering `cook_time_ms` below the stored `stock_time_ms` → `422 CONFIG_REFERENCE_INVALID` `stock_time_exceeds_cook_time`, never a SQL CHECK `500`) | as the rule |
| Path `branch_id` must be in the JWT's `allowed_branch_ids` | `404 BRANCH_NOT_FOUND` |
| Tenant-level write (tax classes, categories, items) needs every branch of the tenant in the owner's `owner_users.allowed_branch_ids`, read at write time (S8) | `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` |

**Item fields at a batch station (v0.6):** at a branch where the item's route is at a batch station, the item's own `cook_time_ms` and `stock_time_ms` are **not used**: the cook time is the program's, and stock tracking follows `stock_program_id` (F §4.7, D49; §4.3). They stay required or validated on the item because the same tenant-wide item may be routed to a slot station at another branch.

> ⚠️ Changed by 01c v1.0 (A4, A17): the item unit rules move to the item's stock draw (`stock_draws[].quantity_per_sale_unit` against the stock item's `stock_unit`, 01c V4); `stock_unit`, `stock_per_sale_unit`, `low_stock_threshold` and `carries_over` are no longer item fields. New item field `requires_weighing` (V18): true needs `sale_unit ∈ g, ml` and no stock draw. 01c §3.3 adds the rules for variant groups, stock items, modifier groups and deals. See 01c §4.5.

### 3.4 Config poll (hub, `apps/hub/src/sync/config-poller.ts`)

Runs every 60 000 ms from boot step 6. One poll runs at a time; a call during a poll waits for its result. **v1.3 (01b D-11):** the interval is the constant `CONFIG_POLL_INTERVAL_MS = 60_000` exported from `packages/events/src/config.ts` (the shared config-delivery contract); the poller imports it instead of its local `POLL_INTERVAL_MS`, and the cloud derives the owner app's staleness threshold from the same constant (§6.7b).

> ⚠️ Changed by 01b (D-11): the poll interval moves to the shared constant `CONFIG_POLL_INTERVAL_MS` in `@pos/events`; value unchanged. See 01b §4.4 row 14.
1. If the hub is not provisioned or not yet confirmed (00 M41): no HTTP call; record `{ outcome: 'not_ready', at }` and stop (S40 N4).
2. `current_config_version` = the `branch_config` row's version, or **0** if there is no row, `config_snapshots` has no body for its hash, or the row's `snapshot_schema_version` ≠ `SNAPSHOT_SCHEMA_VERSION` (S28 b). `current_directory_version` = `staff_directory_meta.directory_version`.
3. `GET /v1/sync/config?config_version=…&directory_version=…`, `Authorization: Bearer <branch_api_key>`, `Accept-Encoding: gzip`, timeout 30 000 ms (v0.7: a 5 000-item snapshot on mobile data, S48). Network error, timeout or 5xx → record `{ outcome: 'offline', at }`, stop. `401` → `last_problem { outcome: 'unauthorized' }`, log an error, stop. In each case the hub stays on its last config. `304` → record `unchanged`, clear `last_problem`, stop.
4. `200`: `JSON.parse` the text, then Zod-parse the envelope with `config.snapshot` typed as raw JSON (`z.record(z.string(), z.unknown())`). Malformed → `last_problem { outcome: 'rejected', reason: 'malformed' }`, stop (nothing written; the log never includes Zod issue inputs, §7.3). For `config`, in this order (S28 d): (i) `sha256hex(canonicalJson(raw))` ≠ `snapshot_hash` → reject the config part (`reason: 'hash_mismatch'`); (ii) `raw.snapshot_schema_version` ≠ `SNAPSHOT_SCHEMA_VERSION` → reject (`'schema_unsupported'`; only between a cloud and a hub not upgraded together, S28 b); (iii) Zod-parse with `BranchConfigSnapshotSchemaV1` (unknown fields dropped) → failure rejects (`'schema_invalid'`); (iv) **forward only** (the M51 pattern): `config_version ≤ current_config_version` → ignore the config part. A rejected config part still lets the directory part apply. The directory part applies only when newer (00 M51, inside `applyStaffDirectory`).
5. If nothing is left to apply, stop. Steps 4 (i)–(iii) run before this step, outside the writer (S48 d). Otherwise one `writer.run`: (a) config part: `INSERT OR IGNORE INTO config_snapshots (snapshot_hash, …, body = canonicalJson(raw))`, append `BranchConfigApplied` (`actor_id` null, `device_id 'hub'`); the projection writes `branch_config`; the `onBranchConfigApplied` hooks run. (b) directory part: `applyStaffDirectory(tx, directory, setDirectory)` (00's signature, unchanged). **If this transaction throws:** S43 (record `apply_failed`, then retry the directory part alone, then the config part alone, each in its own `writer.run`).
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
| `EngineState.business_day` | `{ business_date, opened_at, closed_at \| null, units } \| null` from `BusinessDayOpened` / `BusinessDayClosed` (S33); `openDayStartMs(state)` = `opened_at` while open, else `null`, is the `businessDayStartMs` callers pass to `availableStock` and `stockLevel`; `dayUnits(state, item)` = the units frozen for the open day (S44) | 02 (hub and clients), 03a, 05 (Z report, day open and close) |
| `parseQuantity(text, unit)`, `formatQuantity(n, unit)` | **`@pos/domain`** root (`packages/domain/src/units.ts`, browser-safe): kg / L text with ≤ 3 decimals ↔ integer g / ml; pieces as integers (S44) | 01a pages, 02 clients |
| `inAvailabilityWindows(windows, localTimeOfDayMs)`, `localTimeOfDayMs(nowMs, utcOffsetMs)` | **`@pos/domain`** root (`packages/domain/src/availability-windows.ts`, browser-safe): `[start, end)` windows with wrap past midnight; empty = always; the offset is passed in, never read from the runtime (S47); `isOrderableByTime(item, category, hubNowMs, utcOffsetMs)` = inside the item's windows (if any) and the category's (if any) | 02 (SubmitOrder on the hub; display in clients with `hub_time`), 01a stock page |
| `lineTotalMinor(price_minor, quantity, sale_unit)` | **`@pos/domain`** root (`packages/domain/src/line-total.ts`, browser-safe; v1.0): `piece` → `price_minor × quantity`; `g` / `ml` → `price_minor × quantity / 1000` (price is per kg / L, S44) **rounded half-up to a multiple of 100 minor units (the nearest whole rupee), per line** (v1.2, S59, owner answer Q6.13); integer arithmetic only (`BigInt` for the product), never floats | 02, 01c, 05 |
| `hub_time` | `{ now_ms, utc_offset_ms }` in the catch-up `branch_config` part (§4.5), §6.19 and §6.23 (S47) | 02 clients, 01a stock page |
| `DEFAULT_DAY_STALE_AFTER_HOURS = 16`, `DEFAULT_DAY_MIN_GAP_HOURS = 4` | `@pos/domain` root; the hub's values before its first config (S33) | hub |
| `SNAPSHOT_SCHEMA_VERSION = 1`, `BranchConfigSnapshotSchemaV1` (⚠️ Changed by 03a v1.0: now **3**, `BranchConfigSnapshotSchemaV3`, §4.3) | `@pos/events/src/config.ts` (S28); within version 1 only optional fields may be added (S28 c); a new version is a release of the cloud and every hub together (S28 b) | 05, 06 |
| `QueryCtx.state`, `QueryCtx.branchConfig` | read-only engine state; `branchConfig()` | 02, 03a |
| `GET /queries/branch-config` | current snapshot for staff and station clients (§6.23) | 02, 03b clients |
| WS catch-up parts `branch_config`, `availability`, `stock` | §4.5 | 02, 03b clients |
| `@pos/engine`: `EngineState` (contains `stock` and `business_day`, S14, S33), `applyEvent` (folds `StockSet`, `StockAdded`, `BusinessDayOpened`, `BusinessDayClosed`), `openDayStartMs(state)`, `dayUnits(state, item)` (S33, S44), `canServeFromStock(available, quantity, stockPerSaleUnit)` (S14), `countIsValid(entry, businessDayStartMs, item)` and `availableStock(state, itemId, businessDayStartMs, item)` (S41: 0 when the count is not valid, else `max(0, on_hand − reserved)`), `stockLevel(state, itemId, businessDayStartMs, item)` (S46), `saleUnitsAvailable(available, stockPerSaleUnit)` (S44), `stockOf(state, itemId)` = the entry or `{ on_hand: 0, reserved: 0, set_at: null, unit: 'piece' }`, `ENGINE_STATE_VERSION = 1` | 03a extends; does not change the stock shape |
| ⚠️ Changed by 03a v1.0 (A-16) | `ENGINE_STATE_VERSION = 3`; `EngineState` gains 03a's slices (`config`, `stations`, `orders`, `lines`, `slips`, `next_alert_due_at`, `slip_due`; 03a v1.0 §3.3). The `stock` and `business_day` slices keep their shape | 03a |
| Permission `manage-stock` | `@pos/domain/src/permissions.ts`; default Owner and Manager | 01b UI |
| `@pos/domain/hash`: `canonicalJson`, `sha256hex` (S27) | server-only subpath export | hub, cloud, 06 |

**Events introduced (all `schema_version: 1`):**

| Event | `stream_type` / `stream_id` | Payload | Pushed to (§4.5) |
|---|---|---|---|
| `BranchConfigApplied` | `hub` / branch_id | `{ config_version, snapshot_schema_version, snapshot_hash, previous_config_version \| null }` | staff and station sockets |
| `StockSet` | `stock` / item_id | `{ item_id, on_hand, unit }` (`on_hand` in `unit`, S44) | staff sockets |
| `StockAdded` | `stock` / item_id | `{ item_id, quantity, unit }` (S45); ⚠️ Changed by 03a v1.0 (A-19): v2 (01c V5) gains optional `reason?: 'moved'` | staff sockets |
| `BusinessDayOpened` | `hub` / branch_id | `{ business_date, units: { [item_id]: { stock_unit, sale_unit, stock_per_sale_unit } } }` (`business_date` is a `YYYY-MM-DD` label; `recorded_at` is the start; `units` for every stock-tracked item at the open, S33, S44) | staff sockets |
| `BusinessDayClosed` | `hub` / branch_id | `{}` (`recorded_at` is the end, S33; 05 adds fields for the Z report) | staff sockets |
| `ItemMadeUnavailable` | `stock` / item_id | `{ item_id }` | staff sockets |
| `ItemMadeAvailable` | `stock` / item_id | `{ item_id }` | staff sockets |

**Cloud:** `GET /v1/sync/config` (§6.1), stable for 06; the `idempotency` helper `withIdempotency(ctx, request, fn)` (`apps/cloud/src/lib/idempotency.ts`), used by every later creating `POST` (01b, 05); `bumpConfigVersion(tx, scope)` (refuses a tenant-wide bump for an owner who does not cover every branch, S8); `writeConfigAudit(tx, entry)` (`apps/cloud/src/lib/config-audit.ts`, S26); the CLI `restore-bump` (S42), for 06's restore runbook.

> ⚠️ Changed by 01c v1.0 (A5): engine functions are re-keyed by stock item: `stockOf(state, stockItemId)`, `countIsValid(entry, dayStartMs, stockItem)`, `availableStock(state, stockItemId, dayStartMs, stockItem)`, `stockLevel(…)`, `dayStockUnit(state, stockItem)`, `dayDraws(state, item)` (01c §4.2); `isStockTracked(config, item)` → `isStockTracked(item)` = `item.stock_draws.length > 0` (callers: hub `queries/stock.ts`, `commands/open-business-day.ts`, `commands/set-precooked-stock.ts`, `ws/restaurant-catch-up.ts`). Events: `StockSet` v2 `{ stock_item_id, on_hand, unit }`, `StockAdded` v2 `{ stock_item_id, quantity, unit }`, `BusinessDayOpened` v2 (per-day `stock_units` and `draws`), each upcast from v1 (01c §5.3). See 01c §4.5.

### 4.3 Branch config snapshot (`@pos/events/src/config.ts`, `BranchConfigSnapshotSchemaV1`)

Arrays are sorted by `sort_order`, then id, so `canonicalJson` is stable (tax classes, programs and stations, which have no `sort_order`, by name, then id; v1.0.1 states the station order the builder already used). Only active rows, except stations, programs and tax classes, which keep archived rows with `is_archived: true` (S22). `BranchConfigSnapshotSchema` in earlier sections means `BranchConfigSnapshotSchemaV1` (S28).

```json
{
  "snapshot_schema_version": 1,
  "config_version": 42,
  "branch_id": "01JBF2A0000000000000BR0001",
  "currency_code": "PKR",
  "tax_enabled": false,
  "day_stale_after_hours": 16,
  "day_min_gap_hours": 4,
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
  "categories": [ { "category_id": "01JC…C1", "name": "Karahi", "sort_order": 1,
                    "availability_windows": [] },
                  { "category_id": "01JC…C2", "name": "Breakfast", "sort_order": 2,
                    "availability_windows": [ { "start_ms": 25200000, "end_ms": 46800000 } ] } ],
  "items": [
    { "item_id": "01JC…I1", "category_id": "01JC…C1", "name": "Chicken Karahi — Half",
      "group_label": "Chicken Karahi", "description": null, "sort_order": 1,
      "price_minor": 120000, "tax_class_id": "01JC…X1", "serve_mode": "sync",
      "prep_buffer_ms": 0, "cook_time_ms": 1200000, "stock_time_ms": 300000,
      "out_of_stock_behaviour": "cook_fresh",
      "stock_unit": "g", "sale_unit": "piece", "stock_per_sale_unit": 250,
      "low_stock_threshold": 1000, "carries_over": false, "availability_windows": [],
      "station_id": "01JC…S1", "program_id": null, "stock_program_id": null }
  ]
}
```

`tax_class_id` may be `null` (never taxed, S34); `tax_enabled` is the branch flag (S34 b). v0.7: `business_day_start_ms` is removed (S33); items carry `stock_unit`, `sale_unit`, `stock_per_sale_unit` (S44), `low_stock_threshold` (S46), `carries_over` (S41) and `availability_windows`, and categories carry `availability_windows` (S47), sorted by `start_ms`. All are required in schema version 1 (no hub runs version 1 yet). v1.0: the branch settings `day_stale_after_hours` and `day_min_gap_hours` (S33). Windows are sorted by `start_ms`, `end_ms`, `window_id`.

v1.2 (S57): `items[].price_minor` is the branch's effective price, `COALESCE(item_routes.price_minor_override, menu_items.price_minor)`; the snapshot has no separate override field.

An item is **stock-tracked** at a branch when its route is at a slot station and `stock_time_ms` is not null, or at a batch station and `stock_program_id` is not null. At a batch station the item's `cook_time_ms` and `stock_time_ms` are not used: cook times come from `programs[].cook_time_ms` (§3.3, D49).

> ⚠️ Changed by 01c v1.0 (A3, A17): snapshot schema 2 (`BranchConfigSnapshotSchemaV2`, `SNAPSHOT_SCHEMA_VERSION = 2`, 01c §4.6) replaces schema 1: adds `variant_groups`, `stock_items`, `modifier_groups`, `deals`; items carry `variant_group_id`, `variant_name`, `requires_weighing`, `stock_draws` and `modifier_group_ids`, and drop `group_label` and the item unit fields. A new version, not optional fields within version 1 (01c V1, V12; S28 c not used). See 01c §4.5.
>
> ⚠️ Changed by 03a v1.0 (snapshot schema 3, from 03a v1.0 §4.5): **Snapshot schema 3 (`BranchConfigSnapshotSchemaV3`, `SNAPSHOT_SCHEMA_VERSION = 3`), breaking (R29):** adds `points[]` `{ point_id, name, sort_order, is_archived }`; `stations[]` gain `point_id, policy, freeze_ms, min_slack_keep_ms, promise_padding_ms, pressure_window_ms, pressure_amber_bp, pressure_red_bp, pressure_alert_ms, pause_enabled, lane_units, reserve_units, alternates: [{ station_id, order_types, home_for_order_types }], carry_times: [{ point_id, carry_ms }]`; `items[]` gain `weight_pct, max_early_ms, max_carry_ms, max_late_ms, adjust_time_ms`; top-level `engine_settings {…A-12, returns_boost}` and `goes_with: [{ source_kind, source_id, target_kind, target_id, excluded }]`; sorting as 01a §4.3. **Cost:** cloud and every hub released together (01a S28 b; a hub on v2 refuses a schema-3 body and polls again); the builder gains 5 statements (points, alternates, carry times, engine settings, goes-with), so `GET /v1/sync/config` `200` ≤ **32** with the directory and ≤ **27** config-only (*Changed in v0.4, G2 #2:* from 01b's current bounds 27 / 22, 01b v1.4.1 §4.4 row 6, B-5 of 01d v1.0; v0.3's "31" started from the stale 26). The bound is **01b's** (R32 b), so it is carried as 01b row **B-8**, not here; 01c's builder and snapshot tests re-baselined; every fixture builder (`packages/events/testing`) moves to V3; 02 / 03b clients parse V3 only. No hub runs orders yet (R29), so no data migration on hubs. The `engine_settings` are the A-12 fields; the alternates and carry-time lists are A-9 and A-10; the item knobs are A-11.

> ⚠️ Changed by 02a v1.0 (A-1): **Snapshot schema 4 (`BranchConfigSnapshotSchemaV4`, `SNAPSHOT_SCHEMA_VERSION = 4`), breaking (R29):** `floors[]` gain `zones: [{ zone_id, name, sort_order, is_archived }]` and `tables[]` gain `zone_id: string | null` (archived zones are included with `is_archived: true`, like stations; a table's `zone_id` is NULL when its zone is archived). Everything else as schema 3. **Ships in the same release as schema 3, before the pilot: cloud and every hub released together, fixtures move V3 → V4 once.** 02a reads it through `zoneOf(table_id)`.

> ⚠️ Changed by 02b v1.0 (A-1): snapshot V4 (same release, R29) adds `floors[].zones[].routes: [{ item_id, station_id }]`, `floors[].zones[].stock_items: [{ item_id, threshold }]` and `items[].is_ready_item: boolean`. See 02b §3.10, §3.3.

> *As built, 02p task 4 (owner rulings 2026-11-08, AD-10–AD-12):* the five `branch_engine_settings` columns of §5.2a (`queue_auto_send_max_ms`, `zone_undo_ms`, `slow_item_threshold_ms`, `served_estimate_ms`, `comp_reason_chips`) are delivered in the top-level `engine_settings` beside the A-12 fields (no new `settings` key, AD-10); an archived zone is delivered with `is_archived: true` and `routes: []`, `stock_items: []` (its cloud rows stay and apply again on restore, AD-9; AD-11); `routes[]` and `stock_items[]` are sorted by `item_id` (AD-12). Zones of an archived floor are not delivered (`floors[]` holds active floors only; such zones are all archived, §6.4; AD-14).

### 4.4 Requirements carried to other modules

| To | Requirement |
|---|---|
| 02 | **Mid-service safety:** an order line copies `item_id`, `name`, `price_minor`, `tax_class_id` (may be null, S34; **not** `rate_bp`, S31), `serve_mode`, `prep_buffer_ms`, `out_of_stock_behaviour`, **v0.7:** `sale_unit` and `stock_per_sale_unit` (S44), and the route (`station_id`, `cook_time_ms`, `stock_time_ms`, `program_id`, `stock_program_id`, and **v0.6:** at a batch station the programs' `program_cook_time_ms` and `stock_program_cook_time_ms`) from `branchConfig()` at order time (D25, plus the name). A config apply mid-service never changes an open order: a price change, a program cook-time change, or an archived item or program affects new orders only. The tax rate is the exception: 05 resolves it at bill close (S31). |
| 02 | **[ASSUMPTION, S32]** A stock-tracked `sold_out` item with `availableStock = 0` is shown greyed out like an unavailable item, with its own label ("Sold out"), and an order line for it is refused with an 02-defined code. A `cook_fresh` item at 0 stays orderable at the full cook time (D7). |
| 02 | The order line carries an optional free-text **kitchen note** (≤ 80 characters, no price effect), printed on the kitchen ticket and shown on the KDS (with 03b). It covers "less spicy / no onion" without a modifier model. |
| 02 | Read availability through `itemAvailability`; stock through `availableStock(state, itemId, openDayStartMs(state), item)` (S33, S41), on the hub and in clients; serve a line from stock only when `canServeFromStock(available, quantity, dayUnits(state, item).stock_per_sale_unit)` (S14); show pieces left with `saleUnitsAvailable` (S44); use `dayUnits(state, item)` (the units frozen for the open day), not the snapshot's, for the line's `sale_unit`, quantity and the copied `stock_per_sale_unit` (S44); refetch config on the `BranchConfigApplied` push. Tables are shown as tiles per floor in `sort_order`, with no positions. Build the order line on 01c's variant, modifier and deal model (S12). |
| 02 | **Quantities and line totals (S44; v1.0, review 2 S-3):** an order line's quantity is an integer in the day's `sale_unit` (pieces, g, ml); the UI shows kg / L with `formatQuantity` / `parseQuantity`. `price_minor` is per piece, per kg or per L. **The line total is `lineTotalMinor(price_minor, quantity, sale_unit)` from `@pos/domain`** (g / ml: half-up to the nearest whole rupee per line, S59; 02's kg / L quantity input steps by 0.05, i.e. 50 g / 50 ml); 02 never computes it another way. v1.2: the copied `price_minor` is the branch's effective price (S57). Stock is **per item** in 01a; sharing one count across variants (stock pools) is 01c's. `group_label` stays in the snapshot. |
| 02 | **Time windows (S47):** SubmitOrder refuses an item outside its own or its category's windows (hub clock, hub time zone), with an 02-defined code; the ordering screen shows it like an unavailable item with its hours. Clients evaluate windows with `hub_time` (§4.5, §6.23) and `localTimeOfDayMs(hubNow, utc_offset_ms)`, never the device clock or time zone, and re-evaluate each minute (S47). A manual Off always wins; a manual On does not override a window [ASSUMPTION, owner question 12]. |
| 02 | **Low/out alert (S46):** a staff session whose effective permissions include `manage-stock` sees the low/out alert, computed with `stockLevel` from the stock frames (§4.5); others do not. |
| 02 | **Parking (S10, owner answer):** the parking order is identified by the **car number**, shown like a table number; a car type picker (sedan / mini / large, with icons); an optional phone number. No table. |
| 03a | **Closed by 03a v1.0 (§12.4).** ⚠️ Changed by 03a v1.0 (A-18): "the hand-over step" below = `StockConsumed` at `ItemStarted` (03a P-5). Extend `@pos/engine` without changing the stock shape (S14): `StockReserved` / `StockReleased` change `reserved`, by `quantity × stock_per_sale_unit` stock units per line (S44); the hand-over step moves units out of `on_hand` and `reserved`; `StockAdded` adds to `on_hand` (S45); a line is served from stock only when `canServeFromStock(availableStock(…), quantity, copied stock_per_sale_unit)` (S14, review 2 S-1); reservations use the day's units (`dayUnits`, S44), so they never mix units within a day; **at a day open where an item's `stock_unit` changed while it still has `reserved > 0`** (an order open across the close), re-plan those reservations as for `on_hand < reserved`. **Keep `on_hand ≥ 0` and `reserved ≥ 0` (S14).** **A count below the reserved units (v0.6):** a `StockSet` with `on_hand < reserved` triggers the D23 recalculation, which re-plans the `reserved − on_hand` most recently reserved units at the full cook time and releases them (`StockReleased`), so no open order keeps a stock-time ETA for a unit that does not exist. Hooks on `onBranchConfigApplied` must accept every valid config; a throw fails the apply (S43). **[ASSUMPTION, S32]** for a `sold_out` item, `availableStock = 0` means "cannot be reserved", never "fall back to the full cook time"; first-submit-wins (E1 stock AC4) then refuses the second order instead of re-quoting it. Replace 01a's boot step 3 with full replay. Through `onBranchConfigApplied`, define what a changed station `capacity`, `station_type`, program `cook_time_ms` or an archived station does to live reservations (D37 recalculation, or new orders only). |
| 03b | KDS tickets for an archived station still render (S22). Print the kitchen note. **E1 floors AC6 and edge case "warn admin about in-flight tickets" (deferred from 01a):** the cloud cannot see tickets, so the warning belongs on the hub. Through `onBranchConfigApplied`, when `next` archives a station that has open tickets, show a warning on that station's KDS and on the hub admin page; the tickets complete normally. |
| 02, 03b clients | **Client stack (S35, S39):** add each new surface (ordering, cashier kiosk, KDS) as an entry of `apps/client`, built and served like `admin-stock`; reuse `PinPad` and `StaffTiles` from `src/components/` for the staff login; style only with `packages/ui-kit`; the `apps/client` dependency list is closed (S35 g). Extend `ship-client.sh` to ship every hub-served entry, not only `admin-stock`. |
| 02, 03b clients | On connect, read `catch_up.state.branch_config` (§4.5); if its `snapshot_hash` differs from the cached one, fetch `GET /queries/branch-config` (§6.23). On a `BranchConfigApplied` frame, do the same. Apply `ItemMade*`, `StockSet`, `StockAdded`, `BusinessDayOpened` and `BusinessDayClosed` frames to the `availability` and `stock` parts (a `StockSet` frame sets `on_hand`, `unit` and `set_at = recorded_at`; a `StockAdded` frame adds to `on_hand`; a `BusinessDayOpened` / `BusinessDayClosed` frame sets or closes `business_day`, through `applyEvent`). Keep `hub_time` from the catch-up and from §6.23. Compute `available` and the level with `applyEvent`, `availableStock` and `stockLevel` from `@pos/engine` (S35 f, S41, S46); a stale count drops to 0 when the `BusinessDayClosed` or `BusinessDayOpened` frame arrives. |
| 05 | **Tax at bill close (S31, S34):** tax applies to a line **only when** `branchConfig().tax_enabled` is true at bill close **and** the line's `tax_class_id` is not null. Otherwise the line carries zero tax. 05 then resolves the rate from `branchConfig()` at that moment, including a tax class archived since the order (it stays in the snapshot with `is_archived: true`, S22). **Tax by bill type and payment method (owner answer, v0.7):** a rate, or no tax, per bill type (dine-in, takeaway, delivery) and per payment method; stored as data the owner pages edit (P2). Inclusive/exclusive pricing and rounding are 05's. Today's tax class = `{ tax_class_id, name, rate_bp }`; 05's rules extend the snapshot with optional fields (S28 c) or a coordinated new schema version. **Bill-level rounding** (e.g. to whole rupees) is 05's; each line's total is already rounded by `lineTotalMinor` (§4.2). **PRA (OQ15) is deferred to the end:** the pilot runs in parallel with the restaurant's existing billing, which keeps issuing receipts. |
| 05 | **Business day (S33, v1.0):** 05's shift and day open/close replace 01a's `OpenBusinessDay` / `CloseBusinessDay` and keep `BusinessDayOpened` / `BusinessDayClosed` as the events that start and end a business day (05 adds the Z report and shift close to the close, as fields within schema version 1 of the events or a new version). The Z report covers one open → close. Day close writes no `StockSet`; while no day is open, counts of items that do not carry over read 0 (S41). `day_stale_after_hours` and `day_min_gap_hours` stay branch settings (P2). Manual Off toggles do not reset at the day start (S30, confirmed). |
| 05 | **Shifts and cashier handover (owner answer, v0.7):** shifts with a cashier handover; an order taker may be allowed to close bills on their own tables, with a per-person cash count. Built as permissions and settings (P1, P2), not role names. |
| 06 | Reuse `GET /v1/sync/config` and the poller; do not add a second config path. After any restore, run one config poll **before opening `/auth/*`**; a cloud-only restore leaves `config_snapshots` empty, so the poll fetches in full (S5). **After any cloud database restore or reseed, run `restore-bump --tenant <id>` before hubs poll again** (S42); without it, a restored lower `config_version` or `directory_version` is ignored by every hub. The runbook then re-applies the staff removals and PIN resets made after the backup (S42 consequence). |
| 01b | Every staff/role write bumps `tenants.directory_version` (00 M51), so the next 01a poll delivers it. Use `withIdempotency` on creating `POST`s. Own `GET /v1/admin/branches` and the branch settings endpoint (`tax_enabled`; S37, §12.5). Audit staff removals and PIN resets so the restore runbook can re-apply them (S42). Build 01b's owner pages as views of the `apps/client` owner entry (S35). **Owner answers (v0.7):** permission **scopes** (a permission limited to the person's own tables, or to a floor); assignable **responsibilities** (e.g. stock counting for a station, S38); **no role-named behaviour** (R5); session idle TTL defaults stored in restaurant settings and editable by the owner (P2). **v1.3 (01b B13): idle TTLs are per role** (`roles.session_idle_ttl_ms`, 1–240 min, edited on the role), not restaurant settings; this departs from the row as first written. |
| 01c | Variants (sizes, half/quarter, weighted items), modifier groups (extras/sides as categories; paid or free; min/max), deals/combos (each part routed to its own station), on top of 01a's item, route, units (S44) and windows (S47). Written after 01a and before 02 (S12, §12.5). **v1.0 (review 2 S-3):** 01a's stock is **per item**; **stock pools** (one count shared by several variants, e.g. a karahi pot sold as Half and Full) are 01c's, including the stock key a variant reserves from and its factor. **Keep `group_label`** (it is required in snapshot schema 1; removing it would be a breaking change, S28). Line totals use `lineTotalMinor` (§4.2); 01c defines how modifier and deal-part prices add to a line. 01c lists, for 02, the line's identity (item + variant), modifier and deal-part line shapes, and their routes, stock and windows. |


> ⚠️ Changed by 01b (B13): the 01b row's idle TTL is per role, not a restaurant setting. See 01b §4.4.

> ⚠️ Changed by 01c v1.0 (A6): the 01c, 02 and 03a rows are replaced by 01c §4.3 (the `ItemAdded` v1 order-line contract) and §4.4. **Kept:** the 02/03a batch cook-time copy (`program_cook_time_ms`, `stock_program_cook_time_ms` in `ItemAdded`, 01c B1). See 01c §4.5.

### 4.5 WS pushes and catch-up (F §6.5)

**No new `WsServerMessage` member.** 01a's pushes are frames of the existing `event` member of the union in `@pos/events/src/ws.ts`. That member already carries any `event_type` with its payload, and both ends validate it. The payload schemas are the six event schemas in `@pos/events` (§4.2). The catch-up adds parts to the existing `catch_up.state` record, through `registerCatchUp`. `WsClientMessage` is unchanged.

```json
{ "type": "event", "seq": 20811, "event": { "event_id": "01JC…", "event_type": "ItemMadeUnavailable", "schema_version": 1, "payload": { "item_id": "01JC…I1" } } }
{ "type": "event", "seq": 20812, "event": { "event_id": "01JC…", "event_type": "BranchConfigApplied", "schema_version": 1, "payload": { "config_version": 43, "snapshot_schema_version": 1, "snapshot_hash": "9f2c…", "previous_config_version": 42 } } }
```

**Audiences** (`registerEventAudience`, `apps/hub/src/ws/restaurant-audiences.ts`). Sockets are `staff` or `station` (00 `SocketCtx.kind`). Admin sessions have no socket: `/ws` accepts only staff and station sessions (00 `ws/server.ts:191`).

| Event | `staff` socket | `station` socket | Why |
|---|---|---|---|
| `BranchConfigApplied` | yes | yes | The KDS shows station names and `completion_mode`, which come from the config |
| `ItemMadeUnavailable`, `ItemMadeAvailable` | yes | no | Only ordering screens show availability (E0 availability AC1) |
| `StockSet`, `StockAdded` | yes | no | Only ordering screens show the countdown (E1 stock AC2) and the low/out alert (S46); the KDS does not |
| `BusinessDayOpened`, `BusinessDayClosed` | yes | no | Clients recompute `available` at the day's start and end (S33, S41) |

**Catch-up parts** (`registerCatchUp`, `apps/hub/src/ws/restaurant-catch-up.ts`). Each is built from memory or one statement. A part covers what a client missed while it was disconnected.

| Part | `appliesTo` | Shape | Built from |
|---|---|---|---|
| `branch_config` | staff, station | `{ config_version, snapshot_hash, hub_time: { now_ms, utc_offset_ms } } \| null` (null before the first apply; v1.0 adds `hub_time`, S47). The body is fetched with §6.23 only when the hash changed (not resent on every reconnect) | memory (`branchConfig()` and its hash) and the clock |
| `availability` | staff | `{ unavailable_item_ids: string[] }` (sorted) | 1 statement on `item_availability WHERE is_available = 0` |
| `stock` | staff | `{ business_day: { business_date, opened_at, closed_at, units } \| null, business_day_started_at, items: { [item_id]: { on_hand, reserved, set_at, unit, available, level } } }` for stock-tracked items in the config; `business_day_started_at` = `openDayStartMs(state)` (null while no day is open); `unit` from `dayUnits`; `available` from `availableStock` (S41), `level` from `stockLevel` (S46) | `EngineState` (the `state` argument) and `branchConfig()` |

**Latency (E0 availability AC1, "within 5 s"):** the push runs right after COMMIT (F §6.3 step order), with no timer or batching in between. Test 90 checks it under fake timers. A device that was offline for the change gets it in `availability` on reconnect.

> ⚠️ Changed by 01c v1.0 (A7): the catch-up `stock` part is keyed by `stock_item_id` (`stock.items`, 01c §6.21); `availability` is unchanged. See 01c §4.5.

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

No stock table (D50) and no business-day table: the open business day is in `EngineState.business_day`, folded from `BusinessDayOpened` / `BusinessDayClosed` (S33). Boot step 5 reads `branch_config` and its body: 2 primary-key lookups (S15). **Projection times come from the event (v0.6):** `branch_config.applied_at` and `item_availability.changed_at` are the event's `recorded_at`, never the clock, so a rebuild (reset + replay) gives byte-identical rows (test 47) and S30's "Off since" does not move after a replay.

> ⚠️ Changed by 01c v1.0 (A8): no hub migration (01c m9); the hub reads the new events and snapshot through `parseEvent` and the schema 2 parser. See 01c §4.5.

### 5.2 Cloud (PostgreSQL 16) — `0002_restaurant_setup.sql`

**v1.3 (01b B16, B19, B21):** 01b's `0005_staff_roles.sql` (01b §5.1) clamps and tightens `day_stale_after_hours` to 1–48 and `day_min_gap_hours` to 0–12 (`branches_day_settings` is kept), adds `branches.hub_last_seen_at` and `branches.hub_synced_at` (01b B19), a branch name length CHECK and the unique index `branches_name` on `(tenant_id, lower(name))` (no clamp: a violation aborts the migration, 01b review 1 m9, m10), and widens the `config_audit` `entity` and `action` CHECKs (S26). The `0002` SQL below is merged and unchanged.

> ⚠️ Changed by 01b (B16, B19, B21): day CHECKs 1–48 / 0–12, `hub_last_seen_at`, `hub_synced_at`, branch name length and uniqueness, wider `config_audit` lists, in 01b's `0005_staff_roles.sql`. See 01b §4.4.

**v1.2:** `0004_branch_price.sql` adds one nullable column (S57): `ALTER TABLE item_routes ADD COLUMN price_minor_override BIGINT CHECK (price_minor_override BETWEEN 0 AND 1000000000);` Existing routes read null (main price), so no backfill.

**v1.0.1:** `0003_manage_stock_backfill.sql` adds no table; it is the S18 data backfill (one `INSERT … SELECT … ON CONFLICT DO NOTHING` on `role_permissions` for roles named Owner or Manager, and one `UPDATE tenants SET directory_version = directory_version + 1` for the tenants it changed). Test: `[01a S18]` in `apps/cloud/test/db/manage-stock-backfill.int.test.ts`.

Times `BIGINT` Unix ms; money `BIGINT` `_minor`. Tenant-level tables (M16 pattern, `TenantLevelRepository`): `tax_classes`, `categories`, `menu_items`, `availability_windows`, `idempotency_keys`, `config_audit`. **Allowed D54 exception (S40 N3):** `bumpConfigVersion` reads, locks and updates `branches` through `TenantLevelRepository` (`WHERE tenant_id = $1`), because S8's tenant-wide bump must reach every branch of the tenant, not only the JWT's `allowed_branch_ids`; the same locked read is where a tenant-wide write by an owner who does not cover every branch is refused (`403`, S8). v0.7: the same repository method, without the lock, answers `can_edit_tenant` in §6.11 (`coversEveryBranch`); v1.0: both compare with the owner's `owner_users.allowed_branch_ids` row, not the JWT (S8). No other code queries `branches` that way, apart from the `SystemContext` CLIs (`set-branch-settings`, `restore-bump`, M56). Branch-level (`TenantScopedRepository`): the rest. Every index leads with `tenant_id`.

```sql
ALTER TABLE branches ADD COLUMN config_version BIGINT NOT NULL DEFAULT 1;    -- S8 (expand-only); raised by restore-bump (S42)
ALTER TABLE branches ADD COLUMN tax_enabled BOOLEAN NOT NULL DEFAULT false; -- S34
ALTER TABLE branches ADD COLUMN day_stale_after_hours INT NOT NULL DEFAULT 16
  CHECK (day_stale_after_hours BETWEEN 1 AND 72);                           -- S33: stale-day prompt (data, P2)
ALTER TABLE branches ADD COLUMN day_min_gap_hours INT NOT NULL DEFAULT 4
  CHECK (day_min_gap_hours BETWEEN 0 AND 24);                               -- S33: close guard (data, P2)
ALTER TABLE branches ADD CONSTRAINT branches_day_settings
  CHECK (day_stale_after_hours > day_min_gap_hours);                        -- S33: the stale prompt can always close

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

-- ⚠️ Changed by 02a v1.0 (A-1): zones inside a floor. Migration NNNN_zones.sql, the next free cloud
-- migration number at build time (03a's build takes cloud 0007–0008).
CREATE TABLE zones (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, zone_id TEXT NOT NULL,
  floor_id TEXT NOT NULL, name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  sort_order INT NOT NULL DEFAULT 0, archived_at BIGINT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, zone_id),
  FOREIGN KEY (tenant_id, branch_id, floor_id) REFERENCES floors);
CREATE UNIQUE INDEX zones_active_name ON zones (tenant_id, branch_id, floor_id, lower(name))
  WHERE archived_at IS NULL;                                                 -- CONFIG_NAME_TAKEN (per floor)
CREATE INDEX zones_floor ON zones (tenant_id, branch_id, floor_id)
  WHERE archived_at IS NULL;                                                 -- floor archive check, list
ALTER TABLE dining_tables ADD COLUMN zone_id TEXT;                           -- NULL = the floor's implicit zone
ALTER TABLE dining_tables ADD FOREIGN KEY (tenant_id, branch_id, zone_id) REFERENCES zones;
CREATE INDEX dining_tables_zone ON dining_tables (tenant_id, branch_id, zone_id)
  WHERE archived_at IS NULL AND zone_id IS NOT NULL;                         -- zone archive (nulls its tables)

-- ⚠️ Changed by 02b v1.0 (A-1): per-zone item routes and zone stock items, in the same
-- NNNN_zones migration (V4 unbuilt, R29). Replaced as whole lists by the zone routes (§6.6a, §6.6b).
CREATE TABLE zone_item_routes (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, zone_id TEXT NOT NULL,
  item_id TEXT NOT NULL, station_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, zone_id, item_id),
  FOREIGN KEY (tenant_id, branch_id, zone_id) REFERENCES zones,
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items);
CREATE TABLE zone_stock_items (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, zone_id TEXT NOT NULL,
  item_id TEXT NOT NULL, threshold INT NOT NULL DEFAULT 0 CHECK (threshold BETWEEN 0 AND 5000),
  PRIMARY KEY (tenant_id, branch_id, zone_id, item_id),
  FOREIGN KEY (tenant_id, branch_id, zone_id) REFERENCES zones,
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items);

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
  stock_unit TEXT NOT NULL DEFAULT 'piece' CHECK (stock_unit IN ('piece','g','ml')),   -- S44
  sale_unit  TEXT NOT NULL DEFAULT 'piece' CHECK (sale_unit  IN ('piece','g','ml')),   -- S44
  stock_per_sale_unit INT NOT NULL DEFAULT 1 CHECK (stock_per_sale_unit BETWEEN 1 AND 1000000),
  CHECK ((stock_unit = sale_unit AND stock_per_sale_unit = 1)
         OR (stock_unit <> sale_unit AND sale_unit = 'piece')),                     -- S44
  low_stock_threshold INT CHECK (low_stock_threshold BETWEEN 0 AND 1000000),       -- S46, null = no alert
  carries_over BOOLEAN NOT NULL DEFAULT false,                                      -- S41
  is_ready_item BOOLEAN NOT NULL DEFAULT false,                                     -- ⚠️ Changed by 02b v1.0 (A-1): not cooked; never a food line (02b §3.3)
  archived_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, item_id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES categories,
  FOREIGN KEY (tenant_id, tax_class_id) REFERENCES tax_classes);
CREATE UNIQUE INDEX menu_items_active_name ON menu_items (tenant_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX menu_items_category ON menu_items (tenant_id, category_id) WHERE archived_at IS NULL;   -- category archive check
CREATE INDEX menu_items_tax_class ON menu_items (tenant_id, tax_class_id) WHERE archived_at IS NULL; -- tax class archive check
CREATE INDEX menu_items_name_order ON menu_items (tenant_id, lower(name), item_id);  -- §6.11 cursor pages (S48)

CREATE TABLE availability_windows (                                          -- S47: tenant-level, rows (P2)
  tenant_id TEXT NOT NULL REFERENCES tenants, window_id TEXT NOT NULL,      -- window_id: ULID
  item_id TEXT, category_id TEXT,
  CHECK ((item_id IS NULL) <> (category_id IS NULL)),                         -- one target
  start_ms INT NOT NULL CHECK (start_ms BETWEEN 0 AND 86340000 AND start_ms % 60000 = 0),
  end_ms   INT NOT NULL CHECK (end_ms   BETWEEN 0 AND 86340000 AND end_ms   % 60000 = 0),
  CHECK (start_ms <> end_ms),                                                 -- end < start wraps past midnight
  PRIMARY KEY (tenant_id, window_id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES menu_items,
  FOREIGN KEY (tenant_id, category_id) REFERENCES categories);
CREATE INDEX availability_windows_item ON availability_windows (tenant_id, item_id, start_ms)
  WHERE item_id IS NOT NULL;                                                  -- snapshot, menu read, PATCH replace
CREATE INDEX availability_windows_category ON availability_windows (tenant_id, category_id, start_ms)
  WHERE category_id IS NOT NULL;

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

> ⚠️ Changed by 01c v1.0 (A9, A17): 01c's migration `0006_menu_variants.sql` (01c §5.1, expand) deprecates `menu_items.group_label`, `stock_unit`, `stock_per_sale_unit`, `low_stock_threshold` and `carries_over` (expand/contract; dropped later), adds `menu_items.variant_group_id`, `variant_name` and `requires_weighing`, gives `availability_windows` a `deal_id`, and widens the `config_audit` CHECKs (01c §4.2). `0002` is merged and unchanged. See 01c §4.5.

#### 5.2a Cloud — `0007_engine_config.sql` (⚠️ Changed by 03a v1.0, A-1–A-13, A-17–A-20)

> ⚠️ Changed by 03a v1.0 (A-1–A-13): **Cloud migration**  (next free number, e.g. `0007_engine_config.sql`), one transaction, every new table with `tenant_id`, `version` (R30 V13: writes need `expected_version`), `created_at`, `updated_at`; times are integer ms.

| Row | Table / column | Type, range | Default | Decision |
|---|---|---|---|---|
| A-1 | **`points`** `point_id` PK ULID, `branch_id` FK, `name` 1–40 (unique among active at the branch), `sort_order` int, `archived_at` | — | migration creates "Pass" per branch | 03a-g0 §2, A12 |
| A-2 | `stations.point_id` | FK points, NOT NULL after backfill | the branch's "Pass" | D8 |
| A-3 | `stations.policy` | `'waada_guard' \| 'edf' \| 'fifo'` | `waada_guard` | D3 |
| A-4 | `stations.freeze_ms` | 0–900 000 | 120 000 | D15 |
| A-5 | `stations.min_slack_keep_ms` | 0–600 000 | 60 000 | D6 |
| A-6 | `stations.promise_padding_ms` | null or 0–1 800 000 (null = branch value) | null | D6 |
| A-7 | `stations.pressure_window_ms`, `pressure_amber_bp`, `pressure_red_bp`, `pressure_alert_ms` | 300 000–3 600 000; 1–20 000 with amber < red; 60 000–3 600 000 | 900 000; 8 000; 10 000; 300 000 | D20 |
| A-8 | `stations.pause_enabled` bool; `lane_units` null or 1–capacity; `reserve_units` 0–capacity | — | false; null (= capacity ÷ lane count, §3.10; v0.3, owner A2); 0 | D21, §3 #5, D8 |
| A-9 | **`station_alternates`** `(station_id, alternate_station_id)` PK, `order_types` ⊆ {dine_in, takeaway, delivery, parking} non-empty, `home_for_order_types` ⊆ `order_types`; both slot, same branch, distinct | — | none | D8, D9, P-3 |
| A-10 | **`carry_times`** `(station_id, point_id)` PK, `carry_ms` 0–600 000 | missing row = 0 | — | D8, D23 |
| A-11 | `menu_items.weight_pct` 10–1000; `max_early_ms` 0–3 600 000; `max_carry_ms` null or 0–600 000; `max_late_ms` null or 0–7 200 000; `adjust_time_ms` 0–3 600 000 (cook time of a `fix` return) | — | 100; 60 000; null; null; 180 000 | D3, D28 |
| A-12 | **`branch_engine_settings`** (PK `branch_id`; *v0.2.1:* written and read through 01b's branch settings endpoint, row B-6; *v0.4 (G2 #27):* `table_lock_ttl_ms` is **02's** setting, not an engine field — it is not in `EngineConfigApplied` — and is placed here only so one 01a bump carries every timing setting, 03a-g0 §5): `weight_dine_in_pct`, `weight_takeaway_pct`, `weight_delivery_pct`, `weight_parking_pct`, `weight_follow_up_pct` (10–1000); `promise_padding_dine_in_ms`, `…_takeaway_ms`, `…_delivery_ms`, `…_parking_ms` (0–1 800 000); `slip_threshold_ms` (60 000–1 800 000); `slip_escalate_ms` (30 000–1 800 000); `cascade_step_ms` (15 000–300 000); `min_gain_ms` (0–600 000); `table_lock_ttl_ms` (60 000–3 600 000, used by 02); `returns_boost` bool (a return is placed as a boost, D28); *v0.6 (G4-2 #2):* `order_abandon_ms` (3 600 000–86 400 000; an order with no tap on any line for this long leaves the engine, §3.3) | — | 100, 200, 200, 200, 300; 180 000 ×4; **120 000** (*v0.6, G4-2 #14:* below the padding, so the order taker hears before the promise is blown, D11; was 300 000); 120 000; 60 000; 60 000; 600 000; **true** (v0.3, owner Q15a); 14 400 000 | D3, D5, D6, D7, D8, D11, D42, D51, D28, §3.3 |
| A-13 | **`goes_with_links`** `link_id` PK, `source_kind` / `target_kind` ∈ {category, item}, `source_id`, `target_id`, `excluded` bool (an item override that removes a category default); unique `(tenant_id, source_kind, source_id, target_kind, target_id)` | — | empty, filled in the owner app (v0.3, owner B21) | D12 |
| A-17 | 01a §6.19 `stock_version` | `STOCK_VERSION_EVENTS` gains `StockReserved`, `StockReleased`, `StockConsumed`; boot reads the version with 2 statements on `events_branch_stream` instead of the step-3 fold (v0.2, pre-G2 #3) | — | — | 01a S15 |
| A-18 | 01a §4.4 To 03a | "the hand-over step" = `StockConsumed` at `ItemStarted` (P-5; v0.2, review §4.5 list) | — | — | S14 |
| A-20 | 01a S14 fold rules | *New in v0.6.2 (G4-3 #3):* "a `StockAdded` whose `unit` differs from the entry's `unit` throws" → the fold leaves the entry unchanged and reports an invariant breach, which the hub logs (03a §3.7); no stock fold throws. The command still never appends such an event (S45), so the case stays a bug signal, now one that cannot fail an unrelated transaction | — | — | S14, S45 |
| A-19 | `StockAdded` v2 (01c V5 schema, 01a S45 rule) | optional `reason?: 'moved'`, additive within v2; absent = a manual add (v0.2, pre-G2 #13) | — | absent | F-18 |

> ⚠️ Changed by 02b v1.0 (A-1): `branch_engine_settings` gains `queue_auto_send_max_ms` (3 600 000–86 400 000, default 14 400 000; the cap of 00 v1.8 M95), `zone_undo_ms` (0–1 800 000, default 300 000), `slow_item_threshold_ms` (60 000–7 200 000, default 900 000; the "25 min" tile clock, E2-SOLD AC2), `served_estimate_ms` (nullable, until 03b), `comp_reason_chips` (1–10 labels of 1–30 chars, default "Late", "Wrong item", "Quality", "Guest", "Other"; `other` always needs a note, 02b §3.9). Written and read like the other fields (01b's branch settings endpoint, B-6); delivered in V4.

The `points` duplicate-name rule is the partial unique index `points_branch_name_active ON points (tenant_id, branch_id, name) WHERE archived_at IS NULL` (serves the duplicate-name check of the points `POST`, a rename `PATCH` and a restore; `409 CONFIG_NAME_TAKEN` as the other named rows). Rows A-17–A-20 are hub and event rows, listed here so the table matches 03a v1.0 §4.5. The pilot values are entered at setup in the owner app (03a v0.3); the defaults above are config defaults only, and `stations.completion_mode` keeps its default `two_tap`.

---

## §6. Endpoints, commands and events

All cloud routes are under `/v1`. Owner routes: JWT, tenant guard, and `branch_id` in `allowed_branch_ids` for branch paths. Every success is `{ data }`. Every creating `POST` runs through `withIdempotency` (S7). Every write runs in one transaction that ends with `bumpConfigVersion` (S8). Shared failure cases, not repeated per route: `400 VALIDATION_FAILED`, `401 JWT_INVALID`, `404 BRANCH_NOT_FOUND`, `422 IDEMPOTENCY_KEY_MISMATCH` (creating `POST`s), and `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` (tenant-level writes, §6.12–6.15, S8). **v1.3 (01b B5):** every JWT owner route also answers `403 PASSWORD_CHANGE_REQUIRED` while the owner's `must_change_password` is set, `401 JWT_INVALID` for a token issued before the owner's last password change or reset (its `cv` claim no longer matches `credential_version`), and `503 SERVICE_UNAVAILABLE` when the guard cannot read the owner row (never `401`, so a database problem never signs the owner out). All three come from 00's JWT guard (00 §6.24a), which reads the owner row once per request; that statement belongs to the guard and is not in the statement counts below (as the branch-key lookup of §6.1 is not).

**Common write script (cloud):** validate (Zod) → `BEGIN` → [creating `POST`: insert idempotency key with `request_hash` over method, filled path and body (S7); on conflict wait, then replay or `422`] → load and lock the target row `FOR UPDATE` (`404` if absent) → rule checks on the merged row (§3.3; reference rows `FOR SHARE`, in id order) → write → `writeConfigAudit` (S26; `before` = the locked row, `after` = the written row) → `bumpConfigVersion` (branch rows last; tenant-wide: read the owner's allowed branches from `owner_users` and refuse an owner who does not cover every branch, S8) → [store the response on the key] → `COMMIT` → respond → [creating `POST`: prune old keys in their own statement, S7]. A unique-index violation on an active name maps to `409 CONFIG_NAME_TAKEN { entity, name }`. Any failure rolls back the write, the audit row and the key together.

#### 6.0 Permission and audit per route (§6.3–6.16)

Every route below needs an owner account: a JWT from `owner_users`, the tenant guard, and the path `branch_id` in `allowed_branch_ids` (S19). The cloud has no permission catalogue in P1; `edit-menu` is a hub permission and gates nothing here. No cloud route emits an event. The hub records the result as `BranchConfigApplied` on its next poll (S5).

| § | Route | Permission | `config_audit` row (entity / action) | Bumps |
|---|---|---|---|---|
| 6.3 | `POST …/branches/:b/floors` | owner | `floor` / `create` | branch |
| 6.4 | `PATCH …/floors/:id` | owner | `floor` / `update`, `archive` or `restore` | branch |
| 6.5 | `POST …/tables` | owner | `table` / `create` | branch |
| 6.6 | `PATCH …/tables/:id` | owner | `table` / `update`, `archive` or `restore` | branch |
| 6.6a | `POST …/zones` | owner | `zone` / `create` | branch |
| 6.6b | `PATCH …/zones/:id` | owner | `zone` / `update`, `archive` or `restore` | branch |
| 6.9 | `POST …/stations` | owner | `station` / `create` | branch |
| 6.9 | `PATCH …/stations/:id` | owner | `station` / `update`, `archive` or `restore`; a slot change also writes one `batch_program` / `archive` row per program it archives | branch |
| 6.10 | `POST …/programs` | owner | `batch_program` / `create` | branch |
| 6.10 | `PATCH …/programs/:id` | owner | `batch_program` / `update`, `archive` or `restore` | branch |
| 6.12 | `POST` / `PATCH /v1/admin/tax-classes` | owner covering every branch (S8) | `tax_class` / `create`; `update`, `archive` or `restore` | every branch |
| 6.13 | `POST` / `PATCH /v1/admin/categories` | owner covering every branch (S8) | `category` / `create`; `update`, `archive` or `restore` | every branch |
| 6.14 | `POST /v1/admin/menu-items` | owner covering every branch (S8) | `menu_item` / `create`, plus one `item_route` / `route_set` per route | every branch |
| 6.15 | `PATCH /v1/admin/menu-items/:id` | owner covering every branch (S8) | `menu_item` / `update` (a price change: `before.price_minor`, `after.price_minor`), `archive` or `restore` | every branch |
| 6.16 | `PUT …/routes/:branch_id` | owner (+ `branch_id` allowed) | `item_route` / `route_set` or `route_removed` (v1.2: `before` / `after` include `price_minor_override`, S57) | that branch |

The reads (§6.2, 6.7b, 6.8, 6.11) write no audit row. **v1.3 (01b B5):** the `PASSWORD_CHANGE_REQUIRED` guard covers all 19 owner routes of this spec: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7b, 6.8, 6.9 (`POST`, `PATCH`), 6.10 (`POST`, `PATCH`), 6.11, 6.12 (`POST`, `PATCH`), 6.13 (`POST`, `PATCH`), 6.14, 6.15, 6.16. §6.1 (branch key) is not affected. v0.7: an item's or category's `before` / `after` include its `availability_windows` array (S47), so a window change is one `update` row on the item or category; windows have no audit entity of their own.


> ⚠️ Changed by 01b (B5): every owner route answers `403 PASSWORD_CHANGE_REQUIRED` while a password change is pending, `401 JWT_INVALID` for a token older than the last password change, and `503 SERVICE_UNAVAILABLE` when the guard cannot read the owner row (00 §6.24a). See 01b §4.4.

### Batch 1 — config delivery, floors and tables

#### 6.1 `GET /v1/sync/config` (branch API key, `tenantScope: 'branch-key'`)

| | |
|---|---|
| Query | `config_version` (int ≥ 0), `directory_version` (int ≥ 0) |
| Script | The tenant guard first resolves the branch key (1 statement, `plugins/tenant-scope.ts:51`, `branchByApiKeyHash`). Then, in one read-only `REPEATABLE READ` transaction (v0.6: statement (1) is inside it, so the version label always matches the content): (1) One statement: `SELECT b.config_version, b.tax_enabled, t.directory_version, t.currency_code FROM branches b JOIN tenants t …` for the key's branch. (2) Both versions equal the query → **`304`, no body** (S4). (3) If `config_version` differs, build the snapshot in 7 fixed statements (floors + tables, stations + programs, tax classes, categories, items ⋈ routes for this branch, and v0.7 one statement for the item and category `availability_windows`, S47). Parse it with `BranchConfigSnapshotSchemaV1` (numbers, not `BIGINT` strings, S27), take `wire = JSON.parse(JSON.stringify(parsed))`, set `snapshot_hash = sha256hex(canonicalJson(wire))` from `@pos/domain/hash`, and send `wire` (S27). (4) If `directory_version` differs, build the directory with 00's `loadDirectory` (5 statements; v1.3: directory shape v2 in 8 statements, 01b §4.3.1). (5) v0.7: a `200` is gzipped with `node:zlib` (`Content-Encoding: gzip`) when the request's `Accept-Encoding` includes `gzip` (S48 b); a `304` has no body to compress. (6) v1.3 (01b B19): after the read transaction, one statement (no lock held by the read): on `304`, `UPDATE branches SET hub_last_seen_at = $now, hub_synced_at = $now WHERE tenant_id = $1 AND branch_id = $2` (the hub reported the current versions, so it has applied everything); on `200`, the same statement setting `hub_last_seen_at` only. A hub that keeps rejecting what it receives never gets a `304`, so its `hub_synced_at` stops moving (01b review 1 M6). |
| Response | `200 { data: { config: { snapshot_hash, snapshot } \| null, directory: Directory \| null } }`; `snapshot.snapshot_schema_version = SNAPSHOT_SCHEMA_VERSION`. The response schema types `snapshot` as `z.record(z.string(), z.unknown())` (S27). The cloud answers `200` whenever a version differs in either direction; the hub decides what to apply (§3.4 step 4). |
| Errors | `401 BRANCH_API_KEY_INVALID`; `400 VALIDATION_FAILED` |
| Queries | after the guard's key lookup: 1 (304), ≤ 13 (200). v1.3: 2 (304), ≤ 17 (200) |

> ⚠️ Changed by 02a v1.0 (A-1): the 200 path reads zones too: **+1 statement** on the current bound (01b's bound row; 01b v1.6 adds +1 more for the assignments in the directory). Snapshot schema 4.


> ⚠️ Changed by 01b (B10, B18, B19): the poll records `hub_last_seen_at` (every poll) and `hub_synced_at` (`304` only) and delivers the additive directory v2 (8 statements). See 01b §4.4.

> ⚠️ Changed by 01c v1.0 (A12): serves snapshot schema 2 (01c §4.6, §6.17). See 01c §4.5.

#### 6.2 `GET /v1/admin/branches/:branch_id/floors`

Returns `{ floors: [{ floor_id, name, sort_order, archived_at, tables: [{ table_id, name, seats, sort_order, archived_at }] }] }`, including archived rows (the page filters). 2 statements. Bounded (one branch), so no pagination.

> *As built, 02p task 6 (owner ruling 2026-11-08, AD-16):* each zone in the floors list also carries its `routes: [{ item_id, station_id }]` and `stock_items: [{ item_id, threshold }]` (sorted by `item_id`, as stored, archived zones included), so the owner app reads a zone's lists here; no zone `GET`. **5 statements** (floors, zones, tables, zone routes, zone stock items), fixed.

> ⚠️ Changed by 02a v1.0 (A-1): each floor also returns `zones: [{ zone_id, name, sort_order, archived_at }]`, and each table `zone_id: string | null`. 3 statements (floors, zones, tables).

#### 6.3 `POST /v1/admin/branches/:branch_id/floors`

Body `{ name, sort_order? }`. `201 { data: { floor } }`. Errors: `409 CONFIG_NAME_TAKEN`. Bumps this branch.

#### 6.4 `PATCH /v1/admin/branches/:branch_id/floors/:floor_id`

Body: any of `{ name, sort_order, archived: boolean }`. Archiving with active tables → `409 CONFIG_IN_USE { entity: 'floor', id, used_by: { entity: 'table', ids } }`. Restoring checks name uniqueness. `200 { data: { floor } }`. `404 FLOOR_NOT_FOUND`.

> ⚠️ Changed by 02a v1.0 (A-1): archiving a floor with active zones → `409 CONFIG_IN_USE { entity: 'floor', id, used_by: { entity: 'zone', ids } }` (checked after the tables rule).

#### 6.5 `POST /v1/admin/branches/:branch_id/tables`

Body `{ floor_id, name, seats?: int | null, sort_order? }`. Floor must be active and in this branch → else `422 CONFIG_REFERENCE_INVALID { field: 'floor_id' }`. `201`. `409 CONFIG_NAME_TAKEN`.

> ⚠️ Changed by 02a v1.0 (A-1): body adds `zone_id?: string | null`. A given zone must be active, in this branch and **on the table's floor**, else `422 CONFIG_REFERENCE_INVALID { field: 'zone_id' }`.

#### 6.6 `PATCH /v1/admin/branches/:branch_id/tables/:table_id`

Any of `{ floor_id, name, seats, sort_order, archived }`. `200`. `404 TABLE_NOT_FOUND`; `409 CONFIG_NAME_TAKEN`; `422 CONFIG_REFERENCE_INVALID`. Archiving a table that has an open order on the hub is allowed. The cloud cannot see open orders; 02 keeps the open order on its copied `table_id` [requirement on 02: an order on an archived table can still be billed and closed].

> ⚠️ Changed by 02a v1.0 (A-1): body adds `zone_id: string | null`. Same check as §6.5 against the table's floor after the patch; changing `floor_id` without a `zone_id` sets `zone_id = NULL` (a zone never crosses floors). A table moved to another zone takes that zone's assigned order taker unless it has its own table assignment (01b v1.6 B-2).

> *As built, 02p task 3 (owner ruling 2026-11-08, AD-4):* restoring a table (`archived: false`, including the S50 (b) Undo chip) whose stored `zone_id` names a zone that is now archived sets `zone_id = NULL` in the same write (the table falls back to the floor's implicit zone, as §6.6b does for active tables); the zone check runs only when `zone_id` or `floor_id` changes or the table is restored.

#### 6.6a `POST /v1/admin/branches/:branch_id/zones` (⚠️ Changed by 02a v1.0, A-1)

Body `{ floor_id, name: 1–40, sort_order? }`; `Idempotency-Key` required (S7). Floor active and in this branch → else `422 CONFIG_REFERENCE_INVALID { field: 'floor_id' }`. `201 { data: { zone } }`. `409 CONFIG_NAME_TAKEN` (per floor). Bumps this branch (S8); one `config_audit` row `zone` / `create` (S26). Statements: idempotency row, floor check, insert, audit, bump.

> ⚠️ Changed by 02b v1.0 (A-1): body also takes `routes?: [{ item_id, station_id }]` and `stock_items?: [{ item_id, threshold? }]` (each ≤ 200, unique `item_id`), stored as whole lists. Every `item_id` is an active item, every `station_id` an active station of the branch; a stock item must be `sale_unit 'piece'` and not `requires_weighing` — else `422 CONFIG_REFERENCE_INVALID { field: 'routes.N.…' | 'stock_items.N.item_id' }`. The response returns both lists.

> *As built, 02p (owner ruling 2026-11-08, AD-15):* every `item_id` in `routes[]` and `stock_items[]` must also have an active `item_routes` row at this branch (the item is sold here, so it is in this branch's snapshot `items[]`), else `422 CONFIG_REFERENCE_INVALID { field: 'routes.N.item_id' | 'stock_items.N.item_id', reason: 'not_found' }`; and §6.16 refuses to remove an item's route at a branch while an active zone of that branch names the item → `409 CONFIG_IN_USE { entity: 'menu_item', id, used_by: { entity: 'zone', ids } }` (as AD-6). The same refusal applies to every write that removes an item's route at a branch (owner, 2026-11-08); today §6.16 is the only such write (§6.15 takes item fields only). Only active zones count; a zone restore (§6.6b AD-9) also drops every kept entry whose item has no active `item_routes` row at the branch (recorded in `after.dropped`).

#### 6.6b `PATCH /v1/admin/branches/:branch_id/zones/:zone_id` (⚠️ Changed by 02a v1.0, A-1)

Any of `{ name, sort_order, archived: boolean }` (a zone never changes floor). **Archiving a zone sets `zone_id = NULL` on its active tables in the same transaction** (they fall back to the floor's implicit zone; 01b assignments to the zone stop applying, 01b v1.6 B-2). Restoring checks name uniqueness. `200 { data: { zone } }`. `404 ZONE_NOT_FOUND`; `409 CONFIG_NAME_TAKEN`. Bumps this branch; audit `zone` / `update`, `archive` or `restore`.

> ⚠️ Changed by 02b v1.0 (A-1): `routes` and `stock_items` as in §6.6a; a list sent replaces the stored list (absent = unchanged, `[]` = clear); one `config_audit` row for the zone covers both lists. Archiving a zone keeps its lists (they apply again on restore). *As built, 02p task 6 (owner ruling 2026-11-08, AD-17):* the owner app archives a zone only after a confirm dialog that names it and says its active tables go back to the floor (S50 b's confirm-first rule, like a floor); no Undo chip, because a restore does not re-zone the tables.

> *As built, 02p task 3 (owner ruling 2026-11-08, AD-5):* restoring a zone whose floor is archived → `422 CONFIG_REFERENCE_INVALID { field: 'floor_id', reason: 'archived' }` (an archived floor has no active zones, §6.4). *As built, 02p task 3 (owner ruling 2026-11-08, AD-9):* restoring a zone drops, in the same write, every stored `routes[]` entry naming an archived item or station and every `stock_items[]` entry naming an archived item or one that is no longer `sale_unit 'piece'` or is `requires_weighing`, and (AD-15, §6.6a) every entry whose item has no active `item_routes` row at the branch (the AD-6 rule; the `config_audit` row records the dropped entries as `after.dropped: { routes, stock_items }`, present only when something was dropped), so an active zone's lists never hold such a reference.


#### 6.7 Branch settings: CLI only in 01a (no endpoint)

`pnpm --filter cloud set-branch-settings --branch <branch_id> --tax-enabled true|false` (`apps/cloud/src/cli/set-branch-settings.ts`, `SystemContext`, M56). v1.0: also `--day-stale-after-hours <1…72>` and `--day-min-gap-hours <0…24>` (S33; **v1.3, 01b B16: 1…48 and 0…12**); at least one option is required, an out-of-range value exits 1 with nothing written. `business_day_start_ms` stays removed (S33). In one transaction it locks the `branches` row `FOR UPDATE`, updates the row, writes a `config_audit` row (`branch_settings` / `update`, `actor_kind 'cli'`, `before` / `after`) and bumps this branch (S8). The owner endpoint (`PATCH /v1/admin/branches/:branch_id/settings`) and its page are **01b's**, with `GET /v1/admin/branches` (§12.5); v1.3: specified in 01b §6.10, with a `GET` of the same path. A bulk table create endpoint is not built (§12.4); v1.1: the owner page adds a range of tables with one §6.5 `POST` each (S51).


> ⚠️ Changed by 01b (B16): CLI ranges 1–48 h and 0–12 h; the owner settings endpoint is 01b §6.10. See 01b §4.4.

#### 6.7a `restore-bump`: cloud CLI, no endpoint (S42)

`pnpm --filter cloud restore-bump --tenant <tenant_id>` (`apps/cloud/src/cli/restore-bump.ts`, `SystemContext`, M56). In one transaction: `UPDATE branches SET config_version = GREATEST(config_version + 1, $now_ms) WHERE tenant_id = $1 RETURNING branch_id, config_version`, then `UPDATE tenants SET directory_version = GREATEST(directory_version + 1, $now_ms) WHERE tenant_id = $1 RETURNING directory_version`; `$now_ms` from the injected clock. Prints each old and new value. No `config_audit` row (no config data changes, S26). Unknown tenant → exit code 1, nothing written. Run after every cloud restore or reseed, before hubs poll (§4.4 06).

#### 6.7b `GET /v1/admin/branches` (v1.2, S58; moved from 01b)

Returns `200 { data: { branches: [{ branch_id, name, status, hub_last_seen_at, hub_synced_at }], hub_stale_after_ms } }` (v1.3, 01b B19: both times nullable; `hub_last_seen_at` the last config poll, `hub_synced_at` the last poll answered `304`; `hub_stale_after_ms = 3 × CONFIG_POLL_INTERVAL_MS` (§3.4), computed by the cloud, not stored, 01b D-11): the tenant's branches whose id is in the JWT's `allowed_branch_ids`, ordered by `name`, then `branch_id`; `status` ∈ `pending_hub`, `active`. JWT, tenant guard (`tenantScope: 'jwt'`); owner account; no audit. 1 statement through `TenantScopedRepository` (`WHERE tenant_id = $1 AND branch_id = ANY($2)`). An allowed id with no row is left out. Bounded (the owner's branches), so no pagination.


> ⚠️ Changed by 01b (B19, D-11): branch rows add `hub_last_seen_at` and `hub_synced_at`, and the response adds `hub_stale_after_ms` (3 × the poll interval); still 1 statement. See 01b §4.4.

### Batch 2 — stations and programs

#### 6.8 `GET /v1/admin/branches/:branch_id/stations`

`{ stations: [{ …station, archived_at, programs: [{ program_id, name, cook_time_ms, archived_at }] }] }`. 2 statements.

> ⚠️ Changed by 03a v1.0 (A-1–A-10): each station also returns its engine fields (A-2–A-8), `alternates` (A-9) and `carry_times` (A-10), and the response lists the branch's `points` `[{ point_id, name, sort_order, archived_at }]` (+1 statement for points, 2 → **3**, as 03a v1.0 §4.5 states).

#### 6.9 `POST /v1/admin/branches/:branch_id/stations` and `PATCH …/stations/:station_id`

POST body `{ name, location_label?, station_type, capacity, freshness_window_ms? (batch only, default 0), completion_mode? }`; `201`. PATCH: any of those fields plus `archived`. Changing `station_type`, or archiving while active routes point at the station → `409 CONFIG_IN_USE { used_by: { entity: 'menu_item', ids } }` (served by `item_routes_station`). Station type change with no routes: the service sets or clears `freshness_window_ms` and archives the station's programs when it becomes `slot`. `404 STATION_NOT_FOUND`; `409 CONFIG_NAME_TAKEN`.

> ⚠️ Changed by 01c v1.0 (A10): archiving a station counted by an active `stock_item_branches` row → `409 CONFIG_IN_USE { used_by: { entity: 'stock_item', ids } }` (01c V16); the in-use check is a plain read after the station lock. See 01c §4.5.

> *As built, 02p task 3 (owner ruling 2026-11-08, AD-6):* archiving a station that an active zone's `routes[]` names → `409 CONFIG_IN_USE { entity: 'station', id, used_by: { entity: 'zone', ids } }` (the active zones' ids), as for `item_routes` (S22).

> ⚠️ Changed by 03a v1.0 (A-2–A-10): the station `POST` / `PATCH` accept the engine fields A-2–A-8 (ranges and defaults in §5.2a) and two nested **replace-lists**, `alternates` (A-9: both slot, same branch, distinct) and `carry_times` (A-10: missing row = 0) (01a C1, C6), and return them in the `GET`. `point_id` must be an active point of the branch (`422 CONFIG_REFERENCE_INVALID { field: 'point_id' }`).

#### 6.9a `POST /v1/admin/branches/:branch_id/points` and `PATCH …/points/:point_id` (⚠️ New in v2.1, 03a v1.0 A-1)

**Cloud endpoints (*Changed in v0.2.1*, Q11 closed: +2, 28 → 30, inside the split line):** `POST /v1/admin/branches/:branch_id/points` and `PATCH …/points/:point_id` (R30 `expected_version`), the only new routes; *Changed in v0.4 (G2 #18):* the `POST` requires `Idempotency-Key` (01a S7, F §6.4, M69), both routes add their case to `apps/cloud/test/helpers/route-cases.ts` (C7), and the A-1 name rule is the partial unique index `points_branch_name_active ON points (tenant_id, branch_id, name) WHERE archived_at IS NULL` (serves: the duplicate-name check of the `POST`, of a rename `PATCH` and of a restore, `409` as 01a's other named rows); points are listed in the existing `GET …/stations` response (01a §6.8, + 1 statement). POST `{ name, sort_order? }` → `201`; PATCH any of `{ name, sort_order, archived }` with `expected_version` (R30). **Answered 2026-11-03 (§12.3 Q-v2.1-1, Q-v2.1-2; developer):** an unknown `point_id` in the path → `404 POINT_NOT_FOUND` (appended to §9, foundation §6.2 and `@pos/domain` errors in the 03a build, no bump, R34); archiving a point that an active station names → `409 CONFIG_IN_USE { entity: 'point', id, used_by: { entity: 'station', ids } }` (the station ids; as for a floor with active tables, §6.4). Devices bound to an archived point stop routing (00 v1.7 H-5).


#### 6.10 `POST /v1/admin/branches/:branch_id/stations/:station_id/programs` and `PATCH …/programs/:program_id`

POST `{ name, cook_time_ms }`, station must be an active batch station → else `422 CONFIG_REFERENCE_INVALID { field: 'station_id' }`; `201`. PATCH any of `{ name, cook_time_ms, archived }`; archiving a program used by an active route (as `program_id` or `stock_program_id`) → `409 CONFIG_IN_USE`. `404 PROGRAM_NOT_FOUND`.

### Batch 3 — menu

#### 6.11 `GET /v1/admin/menu`

v0.7: search and cursor pagination (S48), and `can_edit_tenant`.

| | |
|---|---|
| Query | `q?` (1–60 characters; case-insensitive substring of `name` or `group_label`; `%`, `_` and `\` are escaped, so they match themselves), `category_id?`, `status?` ∈ `active` (default), `archived`, `cursor?` (opaque, from `next_cursor`), `limit?` 1 … 200 (default 50) |
| Response | `200 { data: { can_edit_tenant, tax_classes, categories, items: [{ …item, availability_windows, archived_at, routes: [{ branch_id, station_id, program_id, stock_program_id, price_minor_override }] }], next_cursor: string \| null } }`. `tax_classes` and `categories` (with their `availability_windows`) are returned whole on every page, archived included, because they are small and every item form needs them. Items are ordered by `(lower(name), item_id)` (index `menu_items_name_order`); `next_cursor` encodes the last row's `(lower(name), item_id)` and the next page reads rows after it (keyset, so an insert or archive between pages never repeats or skips a row that stays in the result; a **rename** across the cursor between pages can move a row, so the page de-duplicates by `item_id`, review 2 nit 3). `next_cursor` is null on the last page. Routes only for the JWT's `allowed_branch_ids`. **`can_edit_tenant`** is true when every branch of the tenant is in the owner's `owner_users.allowed_branch_ids` row (the S8 rule, read from the database, without the lock); the owner page opens the menu read-only when it is false (§8.1). |
| Errors | `400 VALIDATION_FAILED` (bad `limit`, `status`, or a `cursor` that does not decode) |
| Queries | 6 fixed: `coversEveryBranch` (one statement joining `branches` and the owner's `owner_users` row, S8), tax classes, categories with windows, the item page (`LIMIT limit + 1`), the page items' windows (`= ANY($ids)`), the page items' routes (`= ANY($ids)`) |

> ⚠️ Changed by 01c v1.0 (A11): the menu read returns the new item fields (variant group, stock draw, `requires_weighing`; no unit fields) and the variant groups (01c §6.3). See 01c §4.5.

#### 6.12 `POST /v1/admin/tax-classes`, `PATCH /v1/admin/tax-classes/:tax_class_id`

`{ name, rate_bp }`; PATCH adds `archived`; archiving one used by an active item → `409 CONFIG_IN_USE`. Bumps every branch. `404 TAX_CLASS_NOT_FOUND`.

> ⚠️ Changed by 01c v1.0 (A10): archiving a tax class used by an active deal → `409 CONFIG_IN_USE { used_by: { entity: 'deal', ids } }` (01c V16). See 01c §4.5.

#### 6.13 `POST /v1/admin/categories`, `PATCH /v1/admin/categories/:category_id`

`{ name, sort_order?, availability_windows? }` (v0.7, S47; default `[]`); PATCH adds `archived`; a PATCH with `availability_windows` replaces the category's windows (delete + one multi-row insert, in the transaction); archiving one with active items → `409 CONFIG_IN_USE`. Bumps every branch. `404 CATEGORY_NOT_FOUND`.

> ⚠️ Changed by 01c v1.0 (A10): archiving a category used by an active variant group or deal → `409 CONFIG_IN_USE { used_by: { entity: 'variant_group' | 'deal', ids } }` (01c V16). See 01c §4.5.

> ⚠️ Changed by 03a v1.0 (A-13): the category `PATCH` accepts a `goes_with` list (the category default: target categories or items), a replace-list of `goes_with_links` rows; read in the existing menu read (§6.11).

#### 6.14 `POST /v1/admin/menu-items`

| | |
|---|---|
| Body | `{ category_id, tax_class_id: string \| null` (required key; `null` = never taxed, S34; the owner page sends `null` for "No tax"), `name, group_label?, description?, sort_order?, price_minor, serve_mode, prep_buffer_ms?, cook_time_ms, stock_time_ms?, out_of_stock_behaviour? (S32, default 'cook_fresh'), stock_unit?, sale_unit?, stock_per_sale_unit? (S44, defaults 'piece', 'piece', 1), low_stock_threshold? (S46, default null), carries_over? (S41, default false), availability_windows? (S47, default []), routes?: [{ branch_id, station_id, program_id?, stock_program_id?, price_minor_override? }] }` (v1.2: `price_minor_override` default null, S57). `routes` has at most one entry per branch. |
| Script | common write script; reference checks lock the category, the tax class (when not null), each station and each program `FOR SHARE`; insert the item, its routes and its windows; bump **every** branch (S8). |
| Response | `201 { data: { item } }` with `routes` |
| Errors | `409 CONFIG_NAME_TAKEN`; `422 CONFIG_REFERENCE_INVALID { field, reason }` (archived or foreign category, tax class, station, program; program rules §3.3; `stock_time_ms > cook_time_ms`); `404 BRANCH_NOT_FOUND` for a route branch outside `allowed_branch_ids`; `403 PERMISSION_DENIED` for an owner who does not cover every branch (S8) |
| Queries | fixed: 1 key insert + 1 per reference kind (`= ANY($ids)`) + 3 inserts (item; route rows in one multi-row `INSERT`; window rows in one multi-row `INSERT`) + 1 audit insert + 3 bump (owner row, lock, update; S8) |

> ⚠️ Changed by 01c v1.0 (A11, A17): the item body takes `variant_group_id`, `variant_name`, `stock_draws` (0–1) and `requires_weighing`, and drops the unit fields (01c §6.4). See 01c §4.5.

#### 6.15 `PATCH /v1/admin/menu-items/:item_id`

Any item field plus `archived`. Item fields only; routes use §6.16. A PATCH with `availability_windows` replaces the item's windows (delete + one multi-row insert, in the transaction, S47). Changing `stock_unit` needs no hub check: a count in the old unit stops being valid (S41, S44). Rules run on the merged row (§3.3; e.g. `sale_unit 'g'` sent alone onto a row with `stock_unit 'piece'` → `400`): lowering `cook_time_ms` below the stored `stock_time_ms` → `422 CONFIG_REFERENCE_INVALID` (`stock_time_exceeds_cook_time`). Archiving needs no in-use check: open orders hold copies (§4.4), and the item disappears from the next snapshot. Bumps every branch. `404 MENU_ITEM_NOT_FOUND`; `409 CONFIG_NAME_TAKEN`; `422 CONFIG_REFERENCE_INVALID`.

> ⚠️ Changed by 01c v1.0 (A10, A11, A17, A18): the PATCH is 01c §6.5: new fields as §6.14; merged-row rules R1–R10 with a stated precedence, including the in-use check on archive (R4, V16: an active option of an active group links the item, or an active deal part offers it → `409 CONFIG_IN_USE`), a `sale_unit` change vs deal parts (R6, D-3) and vs linked options (R10) → `409 CONFIG_IN_USE`, and the weighed-item rules (R7, R8, V18). Last write wins stays (S23); the no-op step runs before the reference checks, as built (01c V13, §12.7 T4). See 01c §4.5.

> ⚠️ Changed by 03a v1.0 (A-11, A-13): the PATCH accepts the five knobs `weight_pct`, `max_early_ms`, `max_carry_ms`, `max_late_ms`, `adjust_time_ms` (ranges and defaults in §5.2a; last write wins, S23 / R30 named divergence) and a `goes_with` list (adds and excludes against the category default, A-13).

> *As built, 02p task 3 (owner ruling 2026-11-08, AD-6):* archiving an item that an active zone's `routes[]` or `stock_items[]` names, or a PATCH that makes a zone stock item not `sale_unit 'piece'` or `requires_weighing`, → `409 CONFIG_IN_USE { entity: 'menu_item', id, used_by: { entity: 'zone', ids } }` (the active zones' ids). The zone lists never hold an archived item or station, or a stock item the §6.6a rule refuses.

#### 6.16 `PUT /v1/admin/menu-items/:item_id/routes/:branch_id`

Idempotent replace of the one route: body `{ station_id, program_id?, stock_program_id?, price_minor_override? }` sets it (v1.2: `price_minor_override` default null = the main price, S57); `{ station_id: null }` removes it (the item is no longer sold at that branch; a non-null override with it → `400`). A `PUT` needs no `Idempotency-Key`: repeating it gives the same state (§6.4 applies to creating `POST`s). `200 { data: { route \| null } }`. Bumps that branch, unless the PUT changes nothing (v1.0.2, S26: no audit row, no bump). Errors as §6.14.

### Batch 4 — hub

Hub commands follow F §6.3 and 00 §3.7. Each is `sessionKind: 'admin'`, permission `manage-stock` (S18), and none is `approvable`.

#### 6.17 `POST /admin/commands/set-precooked-stock` — `SetPrecookedStock`

| | |
|---|---|
| Payload | `{ entries: [{ item_id, on_hand: int 0 … 1 000 000 }] }` (in the item's stock unit for the day, `dayUnits`, S44), 1–200 entries, unique `item_id` (duplicate → `400 VALIDATION_FAILED`) |
| Script | idempotency fast path → `BEGIN IMMEDIATE` → re-check → auth re-check (M39) → `manage-stock` → config present (else `404 MENU_ITEM_NOT_FOUND` for the first entry) → a business day is open (`openDayStartMs(state)` not null, else `409 BUSINESS_DAY_NOT_OPEN`, S33; v1.0: also while the last day is closed) → each entry: item in `branchConfig()` (else `404 MENU_ITEM_NOT_FOUND { item_id }`), stock-tracked (§4.3, else `422 STOCK_NOT_TRACKED { item_id }`) → **one `StockSet { item_id, on_hand, unit: dayUnits(state, item).stock_unit }` per entry, even when `on_hand` equals the current value** (v0.6: a re-count that confirms the same number still records the count and moves `set_at`, S41) → engine fold `applyEvent` for `nextState` → INSERT events + `processed_commands` → COMMIT → swap state (D45) → respond → push |
| Scope (v1.3, 01b B20) | when the session's `manage-stock` grant has scope `my_stations` (00 v1.5 `resolve`), every entry's item must be routed at this branch to one of `stationsOf(staff, 'count_stock')`; otherwise `403 PERMISSION_DENIED { permission: 'manage-stock', reason: 'outside_scope', item_ids }` and nothing is written. Checked after the `manage-stock` step. Scope `branch`: unchanged |
| Result | `{ items: [{ item_id, on_hand, reserved, unit, available, level, set_at }] }`; `available` from `availableStock` with the current business day and the item (S41), `level` from `stockLevel` (S46). `set_at` here is the command's clock reading; the stored value is the event's `recorded_at`, read again when the event is appended, so the two may differ by milliseconds. The stock query (§6.19, test 72) is the source of truth (S40 N8). |
| Engine | touches `EngineState` → COMMIT-failure test required (F §6.7) |
| Note | 03a adds the D23 recalculation trigger to this command through `StockSet`, including the re-plan when `on_hand < reserved` (§4.4); 01a does not recalculate. |


> ⚠️ Changed by 01b (B20): under scope `my_stations` an item outside the person's stations is refused `403 outside_scope`. See 01b §4.4.

> ⚠️ Changed by 01c v1.0 (A13): re-keyed to stock items: entries `{ stock_item_id, on_hand }`, events `StockSet` v2 (01c §6.18). See 01c §4.5.
>
> ⚠️ Changed by 03a v1.0 (A-14): for a count below the reserved units, the command appends 03a's `stockEffects` drafts, `StockReleased` (S14 v0.6), **before** the `StockSet`. Before a unit-changing `StockSet`, it appends `StockConsumed` (03a Q14). Both are in the same transaction (03a v1.0 §3.7).

#### 6.17a `POST /admin/commands/add-precooked-stock` — `AddPrecookedStock` (v0.7, S45)

| | |
|---|---|
| Payload | `{ entries: [{ item_id, quantity: int 1 … 1 000 000 }] }` (in the item's stock unit for the day, `dayUnits`, S44), 1–200 entries, unique `item_id` (duplicate → `400 VALIDATION_FAILED`) |
| Script | as §6.17 up to and including the business-day and per-entry item checks (`404 MENU_ITEM_NOT_FOUND`, `422 STOCK_NOT_TRACKED`, `409 BUSINESS_DAY_NOT_OPEN`) → each entry: if `countIsValid(stockOf(state, item_id), openDayStartMs(state), item)` (S41), one `StockAdded { item_id, quantity, unit: dayUnits(state, item).stock_unit }`; otherwise one `StockSet { item_id, on_hand: quantity, unit: dayUnits(state, item).stock_unit }` (S45) → engine fold for `nextState` → INSERT events + `processed_commands` → COMMIT → swap state (D45) → respond → push |
| Scope (v1.3, 01b B20) | when the session's `manage-stock` grant has scope `my_stations` (00 v1.5 `resolve`), every entry's item must be routed at this branch to one of `stationsOf(staff, 'count_stock')`; otherwise `403 PERMISSION_DENIED { permission: 'manage-stock', reason: 'outside_scope', item_ids }` and nothing is written. Checked after the `manage-stock` step. Scope `branch`: unchanged |
| Result | `{ items: [{ item_id, on_hand, reserved, unit, available, level, set_at, recorded_as: 'added' \| 'set' }] }` |
| Engine | touches `EngineState` → COMMIT-failure test required (F §6.7) |
| Note | 03a adds the D23 recalculation trigger to `StockAdded` (more stock can move queued lines to stock time); 01a does not recalculate. |


> ⚠️ Changed by 01b (B20): under scope `my_stations` an item outside the person's stations is refused `403 outside_scope`. See 01b §4.4.

> ⚠️ Changed by 01c v1.0 (A13): re-keyed to stock items: entries `{ stock_item_id, quantity }`, events `StockAdded` v2 or `StockSet` v2 (01c §6.19). See 01c §4.5.
>
> ⚠️ Changed by 03a v1.0 (A-14): after each `StockAdded`, the command appends 03a's `StockReserved` drafts for that stock item's waiting hidden full-cook lines, in the same transaction (03a v1.0 §3.7, foundation v1.9 F-19).

#### 6.18 `POST /admin/commands/set-item-availability` — `SetItemAvailability`

Payload `{ item_id, is_available: boolean }`. Item in config (else `404 MENU_ITEM_NOT_FOUND`). If the current state (projection; a missing row means available) equals the request → no event, `result: { item_id, is_available, changed: false }`. Else one `ItemMadeUnavailable` / `ItemMadeAvailable`; the projection is updated in the transaction. `changed: true`. v1.3 (01b B20): under `manage-stock` scope `my_stations`, an item not routed to one of the person's stations → `403 PERMISSION_DENIED { permission: 'manage-stock', reason: 'outside_scope', item_ids: [item_id] }`, checked after the item is found in config and before any event.


> ⚠️ Changed by 01b (B20): under scope `my_stations` an item outside the person's stations is refused `403 outside_scope`. See 01b §4.4.

#### 6.18a `POST /admin/commands/open-business-day` — `OpenBusinessDay` (v1.0, S33)

| | |
|---|---|
| Payload | `{}` (v1.0: the v0.7.1 `end_current_day` flag is removed; ending a day is `CloseBusinessDay`) |
| Script | idempotency fast path → `BEGIN IMMEDIATE` → re-check → auth re-check (M39) → `manage-stock` → if a day is open (`state.business_day` not null and `closed_at` null): no event, `reason: 'already_open'` → else one `BusinessDayOpened { business_date: the hub's local date of clock.branchNow(), units: { stock_unit, sale_unit, stock_per_sale_unit } of every stock-tracked item in branchConfig() (empty before the first config) }` (`stream_type 'hub'`, branch_id) → engine fold (`business_day = { business_date, opened_at: recorded_at, closed_at: null, units }`) → INSERT + `processed_commands` → COMMIT → swap state (D45) → respond → push |
| Scope (v1.3, 01b B20, D-6) | the day is branch-wide, so `manage-stock` must have scope `branch`; a session whose scope is `my_stations` → `403 PERMISSION_DENIED { permission: 'manage-stock', reason: 'outside_scope', required_scope: 'branch' }`, no event. Checked after the `manage-stock` step |
| Result | `{ business_date, opened_at, changed: boolean, reason: 'opened' \| 'already_open' }` (the open day when `changed` is false) |
| Engine | touches `EngineState` → COMMIT-failure test required (F §6.7) |
| Note | `manage-stock` is the permission until 05's shifts replace this command (§4.4). The first day open after migration makes earlier counts of non-carrying items read 0, as intended (S41). The stock page's Start day action (§8.2) sends it. |


> ⚠️ Changed by 01b (B20): `OpenBusinessDay` needs `manage-stock` scope `branch`; `my_stations` → `403 outside_scope` (D-6). See 01b §4.4.

> ⚠️ Changed by 01c v1.0 (A13): appends `BusinessDayOpened` v2, which freezes each counted stock item's `stock_unit` and each tracked item's `sale_unit` and draws for the day (01c §6.20). See 01c §4.5.

#### 6.18b `POST /admin/commands/close-business-day` — `CloseBusinessDay` (v1.0, S33)

| | |
|---|---|
| Payload | `{}` |
| Script | idempotency fast path → `BEGIN IMMEDIATE` → re-check → auth re-check (M39) → `manage-stock` → no day open → no event, `reason: 'not_open'` → `now = clock.branchNow()`; `now − opened_at < day_min_gap_hours × 3 600 000` (from `branchConfig()`, else `DEFAULT_DAY_MIN_GAP_HOURS`; a negative age counts as recent) → no event, `reason: 'opened_recently'` → else one `BusinessDayClosed {}` (`stream_type 'hub'`, branch_id) → engine fold (`closed_at = recorded_at`) → INSERT + `processed_commands` → COMMIT → swap state (D45) → respond → push |
| Scope (v1.3, 01b B20, D-6) | the day is branch-wide, so `manage-stock` must have scope `branch`; a session whose scope is `my_stations` → `403 PERMISSION_DENIED { permission: 'manage-stock', reason: 'outside_scope', required_scope: 'branch' }`, no event. Checked after the `manage-stock` step |
| Result | `{ business_date, opened_at, closed_at \| null, changed: boolean, reason: 'closed' \| 'not_open' \| 'opened_recently' }` |
| Engine | touches `EngineState` → COMMIT-failure test required (F §6.7) |
| Note | Minimal in 01a: no Z report, no shift close; 05 attaches them to this command (§4.4). The page sends it from **Close day** (with confirmation) and from the stale-day prompt (§8.2). |

> ⚠️ Changed by 01b (B20): `CloseBusinessDay` needs `manage-stock` scope `branch`; `my_stations` → `403 outside_scope` (D-6). See 01b §4.4.
>
> ⚠️ Changed by 03a v1.0 (A-14): in the commit of `BusinessDayClosed` and **before** it, the command appends 03a's `stockEffects` drafts `StockReleased { reason: 'day_closed' }`: for hidden lines only, plus exited lines still holding a reservation (03a v1.0 §3.7). `OpenBusinessDay` appends no `unit_changed` release (03a G2 #21). The day-close checkpoint follows `BusinessDayClosed` (03a §3.12).

#### 6.19 `GET /admin/queries/stock`

`sessionKind: 'admin'`, session required, permission `manage-stock`. v1.0 (review 2 S-5): the page polls this every 15 s, so it is split into a config part and a stock part, each sent only when its version changed.

| | |
|---|---|
| Query | `meta_version?`, `stock_version?` (the values from the page's previous answer; absent on the first read) |
| Versions | `meta_version` = `"<config_version>.<opened_at of the open day, or 0>"`: it changes on a config apply and on a day open, because a day open freezes new units into `items_meta` (S44). `stock_version` = the `seq` of the last committed `StockSet`, `StockAdded`, `BusinessDayOpened`, `BusinessDayClosed`, `ItemMadeUnavailable` or `ItemMadeAvailable`, held in memory: set by the boot step 3 fold from the same scan (all are on the `stock` stream or are the business-day events it already reads, S15), so boot adds no query, and moved forward after each COMMIT that appends one |
| Response | `{ unchanged, config_version, meta_version, stock_version, hub_time: { now_ms, utc_offset_ms }, hub_local_date, business_day: { business_date, opened_at, closed_at } \| null, business_day_started_at \| null, day_stale, day_stale_after_hours, day_min_gap_hours, items_meta: [...] \| null, items: [...] \| null }`. `unchanged` is true, with `items_meta` and `items` null, when both query versions equal the current ones. **`items_meta`** (only when `meta_version` differs or is absent), in config order: `{ item_id, name, group_label, category_id, category_name (v1.0.2: the category's name in the config), is_stock_tracked, out_of_stock_behaviour, stock_unit, sale_unit, stock_per_sale_unit (the day's, from dayUnits, S44), low_stock_threshold, carries_over, item_windows, category_windows }`. **`items`** (when either version differs or is absent): numbers and flags only, `{ item_id, on_hand, reserved, unit, available, level, set_at \| null, is_available, unavailable_since \| null }`. **v1.0.2:** `unit` = `dayUnits(state, item).stock_unit`, the open day's frozen unit (`BusinessDayOpened`), else the config's when no day is open; `day_min_gap_hours` is the branch setting, else `DEFAULT_DAY_MIN_GAP_HOURS` (S33). `business_day_started_at` = `openDayStartMs(state)` (S33); `day_stale` = a day is open and `now − opened_at > day_stale_after_hours × 3 600 000` (the branch setting, else the default, S33); `available` = `availableStock(state, item_id, business_day_started_at, item)` (S41); `level` = `stockLevel(…)` (S46); `unavailable_since` = `changed_at` when the item is off (S30). The page computes "outside hours" itself from the windows and `hub_time` (S47), so time passing never needs a new answer. `on_hand`, `reserved` and `set_at` come from `stockOf(state, item_id)` (S14); v1.0.2: when that count's unit differs from `unit`, they are reported as no count (`0`, `0`, `null`), because a count in another unit is not valid (S41) and its numbers would read in the wrong unit (tests 156, 158). |
| Queries | `unchanged`: 0 statements. Otherwise 1 statement (`item_availability` for the config's items) when `items` is sent, 0 when only `items_meta`. With no config: `items_meta: []`, `items: []`, 0 statements |
| Scope (v1.3, 01b B20) | when the session's `manage-stock` scope is `my_stations`, `items_meta` and `items` hold only the items routed at this branch to one of `stationsOf(staff, 'count_stock')` (from memory); the statement count is unchanged. The response adds `manage_stock_scope: 'branch' \| 'my_stations'` (the session's, D-6) so the page can hide the day actions. Scope `branch`: unchanged |


> ⚠️ Changed by 01b (B20): under scope `my_stations` the stock query lists only the person's stations' items, and the response adds `manage_stock_scope`. See 01b §4.4.

> ⚠️ Changed by 01c v1.0 (A13): re-keyed to stock items: one row per stock item, with the menu items that draw from it listed under it (01c §6.21). See 01c §4.5.
>
> ⚠️ Changed by 02b v1.0 (A-1): `STOCK_VERSION_EVENTS` (`sync/stock-version.ts`), the stock-frame audience (`ws/restaurant-audiences.ts`) and the boot fold lists also take `StockTransferredOut` (03a v1.2 Q-5, a zone refill), so the stock page and tiles update within 5 s.
>
> ⚠️ Changed by 03a v1.0 (A-17): `STOCK_VERSION_EVENTS` gains `StockReserved`, `StockReleased` and `StockConsumed`, so a reservation moves the stock page's `available`. Boot reads `stock_version` with **2 statements** on `events_branch_stream` instead of the step-3 fold, which 03a replaced (A-15).

#### 6.20 Removed in v0.6

v0.5's `POST /admin/config/pull-now` is cut (S24). The number is kept so older references resolve.

#### 6.21 `GET /admin/queries/config-status`

`sessionKind: 'admin'`, session required, permission **`access-hub-admin`** (the same guard as the `/admin/stock` page; §12.2 agrees). `{ tenant_id, branch_id, config_version, snapshot_schema_version, applied_at, directory_version, last_poll: { outcome, at } | null, last_problem: { outcome: 'rejected' | 'unauthorized', reason, at } | null }` from memory and 2 primary-key reads (S29). **v1.0.1 (D7):** `tenant_id` and `branch_id` are the hub's provisioned values (`null` on an unprovisioned hub); the `/admin/stock` page reads them on open, before any command, and puts them in every command envelope, so its commands never get `BRANCH_MISMATCH`. `outcome` ∈ `applied`, `unchanged`, `offline`, `rejected`, `unauthorized`, `not_ready` (S40 N4). `reason` for `rejected` ∈ `malformed`, `hash_mismatch`, `schema_unsupported`, `schema_invalid`, `apply_failed` (S29, S43). The page shows one status line, "Menu version 42 · checked 2 min ago" ("· offline" when the last poll was offline), or "Waiting for hub confirmation" for `not_ready`, plus the problem banner (§8.2).

> ⚠️ Changed by 01d v1.1 (AD-123): the response adds **`stuck_alerts`** (required int: the number of stuck 01d alerts, 01d §3.5), so the query takes **3** statements (was 2). `ConfigStatusResponse` (`packages/events/src/admin/hub.ts`) has the field required, not `.default(0)`; this is safe because the hub and its served client ship together (`ship-client.sh`). The page shows it in the More menu (§8.2). See 01d v1.1 §4.3 To 01a.

#### 6.22 `registerStationValidator` (no route)

`(tx, stationId) => { const c = branchConfig(); return c !== null && c.stations.some(s => s.station_id === stationId && !s.is_archived) }`. It reads memory only; the single writer guarantees the config cannot swap mid-transaction. Registered at module load in `apps/hub/src/sync/station-validator.ts`, before the server listens.

#### 6.23 `GET /queries/branch-config`

`sessionKind: 'device'`, session required, `allowStation: true` (staff and KDS clients). No permission beyond a valid session: every client needs the menu, and the snapshot holds no secret. Returns `{ config_version, snapshot_hash, snapshot, hub_time: { now_ms, utc_offset_ms } } | null` (null before the first apply; `hub_time` v1.0, S47) from memory: the in-memory holder keeps the parsed snapshot with its hash and version. 0 statements. Clients call it only when `catch_up.state.branch_config.snapshot_hash` or a `BranchConfigApplied` frame names a hash they do not hold (§4.5). This is the "clients refetch config" path that v0.1 named but did not define.

> ⚠️ Changed by 01c v1.0 (A12): serves snapshot schema 2 (01c §4.6, §6.17). See 01c §4.5.

#### 6.24 Endpoint count

> ⚠️ Changed by 03a v1.0 (Q11, 03a v0.2.1): + §6.9a ×2 → cloud **22**, total **30**, with the two CLIs **32**; inside the split line on endpoints (~30). The branch engine settings ride 01b's existing settings endpoint (01b v1.5 B-6), and the goes-with lists and knobs ride the existing category, item and station routes. No other route is added.

Cloud: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7b (v1.2), 6.8, 6.9 ×2, 6.10 ×2, 6.11, 6.12 ×2, 6.13 ×2, 6.14, 6.15, 6.16 = **20** (v0.1 said 21 by mistake). Hub: 6.17, 6.17a, 6.18, 6.18a, 6.18b, 6.19, 6.21 and 6.23 = **8**. **Total 28** (v1.2: + §6.7b, moved from 01b, so 01b gets one fewer): above the 10–25 target, under the ~30 split threshold; with the two CLIs, 30. Nothing moves to 01c: the v0.7 settings ride the existing item and category routes and the v1.0 branch settings ride the existing CLI (no new cloud endpoint); the v1.0 stock poll reuses §6.19; and the three new hub commands are stock and day facts 02 and 03a need from 01a. **Budget note:** one more endpoint or CLI takes 01a to the ~30 split threshold; any further addition goes to 01c or 05. History: v0.1 had 24 (it stated 26 by mistake); v0.2 added §6.23; v0.3's branch settings endpoint moved to 01b (§6.7); v0.6 removed §6.20 `pull-now` (S24); v0.7 added §6.17a `AddPrecookedStock` (S45) and §6.18a `OpenBusinessDay` (S33); v1.0 added §6.18b `CloseBusinessDay` (S33). The CLIs `set-branch-settings` and `restore-bump` are not endpoints. Built page routes (`/owner/*` on the cloud, `/admin/stock/*` on the hub, S35) are not counted, as in 00 §6.33.

---

## §7. Cross-cutting

### 7.1 Built client pages (S35, S21)
`apps/{hub,cloud}/src/lib/client-dist.ts`: at registration it reads one build output once, file list and bodies, into memory (`apps/client/dist/owner/` on the cloud, `apps/client/dist/admin-stock/` on the hub, found relative to the helper's own source, S39 b) and serves only those files under the entry's prefix. A release that replaces the files on disk takes effect at the next restart. `index.html` is sent with `Cache-Control: no-cache`; files under `assets/` (Vite content-hashed names) with `Cache-Control: public, max-age=31536000, immutable`. The `Content-Type` comes from a fixed extension map (`.html`, `.js`, `.css`, `.woff2`, `.svg`, `.png`); a file whose extension is not in the map is not served (so `.vite/manifest.json` stays private). `/owner/` and `/admin/stock/` serve their `index.html`. Any other path, including `../` and unlisted names, → `404 ROUTE_NOT_FOUND`. A missing build output is logged at `error` at boot and its routes answer `404`; the server still starts, because the hub must keep taking orders without its stock page. Hub page: route group `admin-page` (host, provisioned and guest-network guards; no credentials, like M79). **Both apps** send the CSP header of S21 on every file they serve from the build (v0.6: the hub too). The helper exists in both apps and moves to a shared place only if the two copies drift (§12.4).

### 7.2 Poller timers
One `setInterval(60 000)` started at boot step 6 and cleared on shutdown, injectable for tests (§6.7 determinism: tests drive `pollOnce()` directly). Fixed interval: the cloud cost of a `304` is one indexed statement after the key lookup, so no backoff is needed. Bandwidth: 1 440 `304`s a day ≈ 1 MB/day per branch with headers; each menu change adds one gzipped snapshot (≈ 20 KB for the pilot menu, ≈ 300 KB at 5 000 items, S48).

### 7.3 Logging
The poller logs each outcome at `info` (unchanged at `debug`; `rejected`, including `apply_failed`, and `unauthorized` at `error`). Logs are not the only signal: the same problems are shown on the stock page (S29). It never logs the snapshot body or the directory (the directory holds PIN hashes, 00 §7.2 redaction). **v0.6:** for a `malformed` envelope it logs only the Zod issue paths and codes, never the issues' `input` or `received` values, because the envelope carries the directory. For `apply_failed` it logs the error's message and stack, never the body or the directory (S43).

### 7.4 Rate limits
None new. `/v1/sync/config` is called once a minute by three known hubs; owner routes sit behind owner login (00 M64).

### 7.5 Performance targets
`304` path ≤ 20 ms p95 on the cloud; snapshot build ≤ 200 ms p95 for 300 items and ≤ 2 s for 5 000 items (S48). Hub apply: hash and parse (outside the writer, but on the main thread; off-thread work is deferred until a branch snapshot exceeds 1 000 items, §12.4) ≤ 100 ms for 300 items and ≤ 1.5 s for 5 000; the `writer.run` part ≤ 100 ms for 5 000 items (it blocks the writer; at a few changes a day this is negligible). Owner menu page (§6.11) ≤ 150 ms p95 for a 50-item page of a 5 000-item menu, with or without `q`. `SetPrecookedStock` with 200 entries ≤ 50 ms p95 on the mini PC. These targets are checked by the manual runbook (§11 step 29) and the hub smoke script (`apps/hub/test/smoke/`), not by automated tests, because timings on shared CI and dev machines are not stable (S40 N10).

### 7.6 Risks
| Risk | Accepted because | Mitigation |
|---|---|---|
| While the branch is offline, a removed staff member keeps working on that hub until the next successful poll (S6) | Pilot; the owner can also force-logout on the hub (00 §6.15) | Config status shows "offline"; the poll runs within 60 s of the internet returning |
| A stock count taken during plating is off by one unit (S14) | The next count corrects it | — |
| Two owner sessions overwrite each other (S23) | One owner | — |
| `config_snapshots` grows forever (insert-only): ~5 changes/day × 60 KB ≈ 110 MB/year for the pilot menu; ≈ 4.5 GB/year at 5 000 items (S48 e) | Within the mini PC's disk for years for the pilot | Pruning deferred (§12.4); its trigger (1 GB) is reached within months for a 5 000-item menu, so it is built before such a tenant goes live |
| A new snapshot schema version deployed to the cloud without every hub (S28 b) | 3 known hubs, released together on site (§7.8) | The hub rejects it (`schema_unsupported`), keeps its last config and shows the danger banner; no data is lost |
| A cloud restore without `restore-bump` (S42) | The CLI step is in the restore runbook (06) | Hubs keep the newer pre-restore menu and directory until the cloud's versions pass theirs; the owner sees the edits missing on the cloud pages |
| After `restore-bump`, staff removed or PIN-reset after the backup come back (S42) | Cloud restores are rare; 01b audits staff changes | The restore runbook re-applies them from 01b's audit trail right after `restore-bump` |
| The first boot after migration 0004 replays the full event log once for the two new projections (`branch_config`, `item_availability`) | The pilot hub is new and its log is small; later boots resume from the projection checkpoints (S40 N12) | — |
| The business-date label (`OpenBusinessDay`, S33) and time windows (S47) use the hub's OS time zone | Single-country pilot, no DST; clients use the hub's clock, not their own (§4.4 02) | Installation checklist sets `Asia/Karachi` on the hub |
| Nobody closes the day at night: yesterday's counts of non-carrying items stay valid until someone acts (S33, S41) | The stale-day prompt asks to close and start a new day once the day is older than `day_stale_after_hours` (default 16, a branch setting); 05's shift close replaces the manual close | Runbook step; the prompt (test 146) |

### 7.7 Folder placement (F §6.9 + S35)
Hub: the poller goes in `src/sync/` (listed in F §6.9). The snapshot apply goes in `src/projections/branch-config.ts`, the availability projection in `src/projections/item-availability.ts`, commands in `src/commands/`, queries in `src/queries/`, the station validator in `src/sync/station-validator.ts`, audiences and catch-up parts in `src/ws/restaurant-audiences.ts` and `src/ws/restaurant-catch-up.ts` (§4.5), the built-page helper in `src/lib/client-dist.ts` (§7.1). Cloud: `src/modules/restaurant/` (routes, service, repository, schemas), `src/modules/config-sync/` (one snapshot builder, `builder.ts`, S28), `src/lib/idempotency.ts`, `src/lib/config-audit.ts`, `src/cli/set-branch-settings.ts` (§6.7), `src/cli/restore-bump.ts` (S42, M56), `src/lib/client-dist.ts` (§7.1). Shared: `packages/domain/src/hash.ts` (subpath export `@pos/domain/hash`, S27), `packages/domain/src/units.ts` (root export, S44), `packages/domain/src/availability-windows.ts` (root export, S47), `packages/domain/src/line-total.ts` (root export, §4.2), `packages/events/src/events/hub/BusinessDayClosed.v1.ts`, `packages/events/src/config.ts`, `packages/events/src/events/stock/*.v1.ts`, `packages/events/src/events/hub/BranchConfigApplied.v1.ts`, `packages/events/src/events/hub/BusinessDayOpened.v1.ts`, `packages/engine/src/{state,apply-event,stock,version}.ts`. Client (S35, F §6.9): `apps/client/{owner,admin-stock}/index.html`, `apps/client/vite.config.ts` (one config, `--mode owner` / `--mode admin-stock`), `src/app/` (hash routes, entry bootstrap, `ulid.ts`, S35 j), `src/features/owner/{login,floors,stations,menu}/`, `src/features/owner/money.ts`, `src/features/admin/stock/`, `src/api/{cloud-admin,hub-admin}.ts` (typed fetch clients using `@pos/events` schemas; v1.0.1, D5: the owner and hub admin request and response schemas are in `packages/events/src/admin/{restaurant,owner-auth,hub}.ts`, zod only, browser-safe; the cloud routes import the same schemas and the client derives its types with `z.infer`), `src/components/` (`PinPad`, `StaffTiles`, `BusyButton`, `Banner`, S35 i), `src/app/ui-kit.ts` (the only stylesheet imports, S35 d), `src/i18n/`. Release: `apps/hub/deploy/ship-client.sh` (S39 d).

### 7.8 Build and release (S39)
**Build** (developer machine, CI, cloud deploy): `pnpm install --frozen-lockfile`, then `pnpm --filter @pos/client build` (*v1.3, 01b Q3:* the optional environment value `VITE_SUPPORT_PHONE` is read at build time by the owner entry; unset → no support number is shown) → `apps/client/dist/owner/` and `apps/client/dist/admin-stock/`. The root `pnpm test` runs the same build first.

**Cloud release:** *v1.3 (01b B22, review 2 N5):* **never redeploy a cloud build older than 01b once its migration `0005_staff_roles.sql` is applied; to undo a release, deploy a newer fixed build.** Builds from 01b on refuse to start on a database that holds a migration they have no file for (00 §5.2); v1.4 builds cannot check this, so this step is the only guard against them.

> ⚠️ Changed by 01b (B22, review 2 N5; Q3): cloud releases roll forward only once 01b's `0005` is applied; the owner build reads the optional `VITE_SUPPORT_PHONE`. See 01b §4.4 rows 15, 16.

At the release commit, build as above, run the new cloud version, then check `GET /owner/` → `200` with `Content-Type: text/html; charset=utf-8` and the CSP header (S21). A `404` means the build is missing: the release is not done. A release that changes the snapshot schema version (S28 b) is done together with every hub release, in the same visit window.

**Hub release** (v0.6: **on site, over the restaurant LAN, outside service hours**; stop → checkout → install → ship-client → start, S39 d). The hub serves nothing between steps 2 and 6, so no restart can pair new code with an old page:
1. On the developer machine, on the restaurant LAN, at the release tag with a clean tree: `pnpm install --frozen-lockfile && pnpm test` (this builds `apps/client/dist/`).
2. **Stop:** `ssh <ssh-target> sudo systemctl stop hub` (`apps/hub/deploy/hub.service`).
3. **Checkout:** `git push <ssh-target>:/opt/pos-hub refs/tags/<tag>` (over the LAN; the hub holds no git credentials), then `ssh <ssh-target> git -C /opt/pos-hub checkout <tag>`.
4. **Install:** `ssh <ssh-target> 'cd /opt/pos-hub && pnpm install --frozen-lockfile --prod'` (no Vite, no dev dependencies; the hub needs internet for the npm registry).
5. **Ship:** `apps/hub/deploy/ship-client.sh <ssh-target>`. It (a) refuses if `git status --porcelain` is not empty or `apps/client/dist/admin-stock/index.html` is missing; (b) refuses unless `ssh <ssh-target> systemctl is-active hub` prints `inactive` or `failed` (v1.0.1, D6: `active`, `activating`, `deactivating`, `reloading`, an empty answer or an ssh failure all refuse, so a hub inside its `Restart=always` delay is never shipped to); (c) refuses if `ssh <ssh-target> git -C /opt/pos-hub rev-parse HEAD` differs from the local `git rev-parse HEAD`; (d) streams `tar -C apps/client/dist -cf - admin-stock` over `ssh` into `/opt/pos-hub/apps/client/dist/admin-stock.new/`; (e) on the hub, moves `admin-stock` to `admin-stock.old` (if present) and `admin-stock.new` to `admin-stock`, then deletes `admin-stock.old`. Exit code 0 only when all steps succeeded. Only `admin-stock` is shipped.
6. **Start:** `ssh <ssh-target> sudo systemctl start hub`. Check `curl -s -o /dev/null -w '%{http_code}' http://<hub-ip>:<http_port>/admin/stock/` → `200` with the CSP header, and `journalctl -u hub -b` has no client-build error from §7.1.

The script is an ops tool that needs `ssh`, so it is checked by the runbook's release drill (§11 step 29), not by Vitest. A first install follows the same steps after the 00 installation. Remote hub updates (not on site) are out of scope (README milestone C).

---

## §8. Client contract

### 8.1 Cloud owner app (`apps/client`, entry `owner`, served at `/owner/`, S35)
| View (hash route) | Purpose |
|---|---|
| `#/login` | Email + password → `/v1/auth/login`; JWT and refresh token in `sessionStorage` (cleared when the tab closes) |
| `#/` | Branch picker from the JWT's `allowed_branch_ids`, showing branch **names** from `GET /v1/admin/branches` (v1.2, S58; the ID tail until it answers or when it fails); skipped with one branch, choice kept per tab (v1.1, S52). Branch settings (`tax_enabled`) are not on 01a's pages; they are 01b's (§6.7) |
| `#/floors` | Floors with their tables; add, rename, reorder (sort number field, no drag), archive/restore; v1.1: add a range of tables at once (S51), Show archived, table dialog with a floor move |
| `#/stations` | Stations and programs; slot/batch; capacity; freshness window; completion mode |
| `#/menu` | Tax classes, categories, items; the item's tax class picker has a **"No tax"** option (`tax_class_id: null`, S34) and it is selected by default; per-branch route picker filtered by station type, with **Price here** per branch (v1.2, S57 e) and a "{branch} Rs {price}" chip on the menu row for each override; prices typed in rupees and converted to paisa by one function in `src/features/owner/money.ts`: trim spaces, remove every comma, then the rest must be ASCII digits with at most 2 decimals (`"1,200"` → `120000`, `"1,20,000"` → `12000000`, `"1,2,3"` → `12300`, harmless); negatives, letters, other digits and more than 2 decimals are rejected (S40 N7); times typed in minutes, stored as `_ms`; **When pre-cooked stock runs out**: "Cook fresh" (default) / "Sold out" (`out_of_stock_behaviour`, S32) [ASSUMPTION]; v0.7: **Stock unit / Sold by** (Pieces, Grams shown as kg, Millilitres shown as L; "Grams per piece" / "Millilitres per piece" field (`stock_per_sale_unit`) shown only when they differ, S44 (v1.0.1 wording); changing any of them shows "Takes effect when the next business day starts; that day needs a new count of this item at every branch", review 2 nit 9), **Low stock alert at** (empty = none, in the stock unit, S46), **Keeps overnight** (`carries_over`, unchecked by default, S41), **Available hours** on items and categories (up to 4 from–to rows in HH:MM, empty = always, S47). Items are listed a page at a time (§6.11) with a search box (`q`, sent 300 ms after typing stops), a category filter, an Active / Archived switch and a **Load more** button while `next_cursor` is not null. **Read-only start (v0.7):** when `can_edit_tenant` is false the menu opens read-only (no save buttons) with one info line saying tenant-wide data needs an owner who covers every branch (S8); a `403 tenant_wide_write` on a save, if it still happens, shows the `errors.PERMISSION_DENIED` text |

Rules: React function components; UI kit classes on plain elements (bundled, S35 d), `light` theme; no `style` prop and no stylesheet other than the kit (S35 d); shared pieces from `src/components/` (S35 i); strings from `src/i18n/` (keys `owner.*`, `errors.<CODE>`; English and Urdu, S49); one primary button per screen; v1.1 shell, dialogs, Saved chip and error texts per S50, cloud-unreachable banner per S53, `#/menu` with no branch (S52); busy button + 3 s slow banner; no `dangerouslySetInnerHTML` (S35 e). Each creating `POST` generates its `Idempotency-Key` with `src/app/ulid.ts` (S35 j) when the form opens and keeps it across retries of that form. On `401 JWT_INVALID` the app refreshes once (`/v1/auth/refresh`), then goes to login. No offline mode: on a network failure the page shows a banner and keeps the form.

> ⚠️ Changed by 01c v1.0 (A14): the owner item form takes a variant group, a stock draw and `requires_weighing` and has no unit fields; new owner views for variant groups, stock items, modifier groups and deals (01c §8). See 01c §4.5.

> ⚠️ Changed by 03a v1.0 (D1, A-1–A-13): owner app pages: the station form's "Timing" group (A-2–A-10), a "Points" page (A-1), the branch settings page's "Kitchen timing" group (A-12, through 01b v1.5 B-6), and the item form's "Timing" group (A-11, A-13). This is the settings screen of 03a D1.

### 8.2 Hub page `/admin/stock` (`apps/client`, entry `admin-stock`, served by the hub, S35)
- Opens on a paired tablet, kiosk or the owner's phone. If there is no admin session, it shows the admin roster and PIN pad (same endpoints as 00 §8.2), built from the shared `StaffTiles` and `PinPad` (S35 i), which 02's staff login reuses. v1.1: sign-in states, header with **Sign out**, filters, add sheet and the hub admin shell per S54; typed counts kept after an idle sign-out (S55); **All N are still right** (S56).
- **Business day (v1.0, S33):** a line "Day open: Sat 24 Oct since 09:12 (15 h)" or "Day closed at 01:10", with a **Close day** button while a day is open (confirmation: "Close the business day? Counts of items that do not keep overnight will read 0 until the next day is started") that sends `CloseBusinessDay`; an `opened_recently` answer shows "This day was started less than \<day_min_gap_hours\> h ago; nothing changed" (v1.0.2: the number is §6.19's `day_min_gap_hours`). The line's style comes from the day's **age**, not its date (review 2 nit 5).
- **Stale-day prompt (v1.0, S33):** when the query says `day_stale: true`, the page shows, above the rows, "Yesterday's day is still open since \<time\>. Close it and start a new day?" with **Close it and start today** (sends `CloseBusinessDay`, then `OpenBusinessDay`) and **Keep it open** (hides the prompt until the page reloads).
- **Start day (v1.0, S33):** whenever no day is open (none yet, or the last one is closed), a large **Start day** action sits above the stock rows, where the count is entered, not only an error banner. One tap sends `OpenBusinessDay {}` (no confirmation), then the entry continues. If a Save counts or Add answers `409 BUSINESS_DAY_NOT_OPEN` (another device closed the day, a stale page), the same action appears next to the save; after the tap the page re-sends the pending save with the **same** `command_id` (a refused command stores no response, 00 M19, so the retry runs) and keeps the typed values.
- **Low/out alert bar (v0.7, S46):** lists the items whose `level` is `low` or `out` ("Low: Chicken Karahi 900 g · Out: Paye"); hidden when none.
- **One status line** from `GET /admin/queries/config-status` (§6.21), read on open and every 15 s: "Menu version 42 · checked 1 min ago" ("· offline" after an offline poll), or "Waiting for hub confirmation" while `last_poll.outcome` is `not_ready`. v0.6: no "Get changes now" button (S24).
  - `last_problem` set → **danger banner** until it clears: `rejected` "Menu update refused (\<reason\>). The hub is still using version 42." (`apply_failed` reads "Menu update could not be applied"); `unauthorized` "The hub's cloud key was refused. Call support."
- A search box and a category filter (client-side, over `items_meta`, S48; v1.0.2: the options show `category_name`). One row per item in config order: name, then for stock-tracked items **Count** (input in the item's display unit: pieces, kg or L, parsed with `parseQuantity`, `inputmode="decimal"` for kg / L and `"numeric"` for pieces, S44), **on orders** (`reserved`), **Left to sell** (`available`, from the query, so a count that is not valid shows 0, S41), an **Add** field with its own **Add** button per row (sends `AddPrecookedStock` for that row, S45; a bottom sheet on a phone, S54), and "Counted 11:05", with a warn badge "Not counted today" when `level` is `not_counted` (S33, S41; never for a `carries_over` item with a count in its unit). An item outside its hours shows an info badge "Hours 07:00–13:00", computed by the page with `isOrderableByTime` and `hub_time` (S47), re-evaluated each minute. A `sold_out` item shows "Sold out when 0" next to the count (S32). Every item has a **Selling On / Off** switch (§6.18); an item that is off with `unavailable_since` before `business_day_started_at` shows the warn badge **"Off since \<Mon 24 Oct\>"** (S30).
- **Save counts** sends one `SetPrecookedStock` (v1.1: one per 200 rows, S56) with **every row whose Count the user touched**: edited (even back to the same number) or confirmed with the row's **Still right** button, which re-sends the shown `on_hand` (v0.6, §6.17, S41). `command_id` from `src/app/ulid.ts` (S35 j), generated per save (and per Add, per Start day, per Close day) and kept for retries (D32).
- Refreshes after each of its own saves, and re-reads `GET /admin/queries/stock` (with its last `meta_version` and `stock_version`, so an unchanged poll is a short answer with no item data, §6.19) and `GET /admin/queries/config-status` every 15 s while the page is visible. An admin session has no WS socket (§4.5), so the page cannot receive pushes. The query does not count as activity (M59), so the poll does not keep an idle admin session alive. A refresh never overwrites a row the user is editing. While the hub is unreachable it shows the reconnect banner and keeps the typed values (UI kit README).

- **v1.3 (01b B20):** under `manage-stock` scope `my_stations` the page shows only the rows the stock query returns (the person's stations); it does no scope filtering of its own. With `manage_stock_scope: 'my_stations'` (§6.19) it hides **Start day**, **Close day** and the stale-day prompt (D-6), and a `409 BUSINESS_DAY_NOT_OPEN` shows "The day hasn't been started. Ask someone who can start the day."

> ⚠️ Changed by 01b (B20): the stock page shows only the person's stations under `my_stations`, and hides the day actions. See 01b §4.4.

> ⚠️ Changed by 01c v1.0 (A14): the stock page lists one row per stock item, with its menu items under it; availability On/Off stays per menu item (01c §8, §3.5.4). See 01c §4.5.

> ⚠️ Changed by 01d v1.1 (AD-123): the page's More menu shows "Stuck alerts: N" while `config-status.stuck_alerts` (§6.21) is above 0. See 01d v1.1 §4.3 To 01a.

### 8.3 i18n
All strings are keys (D12). v1.1: English and Urdu, picked as in 00 M83 (S49).

---

## §9. Error catalogue additions

Appended to F §6.2 and `@pos/domain/src/errors.ts` in the same change (the only allowed foundation edit).

| Code | Status | `details` | Returned when |
|---|---|---|---|
| `BRANCH_NOT_FOUND` | 404 | `{ branch_id }` | Path or route `branch_id` not in the JWT's `allowed_branch_ids`, or unknown |
| `FLOOR_NOT_FOUND` | 404 | `{ floor_id }` | PATCH on an unknown floor |
| `ZONE_NOT_FOUND` | 404 | `{ zone_id }` | PATCH on an unknown zone (⚠️ Changed by 02a v1.0, A-1) |
| `TABLE_NOT_FOUND` | 404 | `{ table_id }` | PATCH on an unknown table (code named in F §6.2 examples; first defined here) |
| `PROGRAM_NOT_FOUND` | 404 | `{ program_id }` | PATCH on an unknown program |
| `TAX_CLASS_NOT_FOUND` | 404 | `{ tax_class_id }` | PATCH on an unknown tax class |
| `CATEGORY_NOT_FOUND` | 404 | `{ category_id }` | PATCH on an unknown category |
| `MENU_ITEM_NOT_FOUND` | 404 | `{ item_id }` | Unknown item on the cloud; hub stock/availability for an item not in the branch config |
| `CONFIG_NAME_TAKEN` | 409 | `{ entity, name }` | An active row in the same scope has the name (§3.3) |
| `CONFIG_IN_USE` | 409 | `{ entity, id, used_by: { entity, ids } }` | Archive or station type change while active rows depend on it (S22) |
| `CONFIG_REFERENCE_INVALID` | 422 | `{ field, reason: 'archived' \| 'not_found' \| 'wrong_branch' \| 'program_required' \| 'program_not_allowed' \| 'program_wrong_station' \| 'stock_time_exceeds_cook_time' }` | A reference breaks §3.3; *as built, 02p task 3 (owner ruling 2026-11-08, AD-7):* the zone writes (§6.5, §6.6, §6.6a, §6.6b) add `reason: 'wrong_floor'` (a table's zone on another floor), `'not_piece'` and `'requires_weighing'` (a zone stock item, §6.6a); each has a client text (S50 e) |
| `IDEMPOTENCY_KEY_MISMATCH` | 422 | `{ idempotency_key }` | Same key, different request hash (S7) |
| `STOCK_NOT_TRACKED` | 422 | `{ item_id }` | `SetPrecookedStock` or `AddPrecookedStock` for an item that is not stock-tracked at this branch (§4.3) |
| `BUSINESS_DAY_NOT_OPEN` | 409 | `{}` | `SetPrecookedStock` or `AddPrecookedStock` while no business day is open: none opened yet, or the last one closed (S33; v1.0 adds the closed case) |
| `POINT_NOT_FOUND` | 404 | `{ point_id }` | §6.9a path names a point not in the branch (Q-v2.1-1) |

v0.6: `SNAPSHOT_SCHEMA_UNSUPPORTED` (v0.3–v0.5) is withdrawn with the schema negotiation (S28 b). It was never merged, so no catalogue entry is removed. A missing `Idempotency-Key` header is `400 VALIDATION_FAILED` with `issues[0].path = 'headers.idempotency-key'`. A tenant-level write by an owner who does not cover every branch reuses the foundation's `403 PERMISSION_DENIED` with `details { reason: 'tenant_wide_write' }` (S8); no new code.

> ⚠️ Changed by 01c v1.0 (A15): `CONFIG_REFERENCE_INVALID.reason` adds `category_mismatch`, `unit_mismatch`, `linked_item_not_piece`, `choices_unsatisfiable`, `defaults_exceed_max`, `too_many_groups`, `choice_unit_mismatch` (and 01c §9's `weighed_item_in_deal`, `weighed_item_stock_draw`); `STOCK_NOT_TRACKED` is no longer returned by the stock commands (kept in the catalogue, never reused). New codes are in 01c §9. See 01c §4.5.

---

## §10. Tests

Names cite `[01a §10 #n]`. Hub tests: temp SQLite + `inject()`; cloud tests: PostgreSQL 16 (F §6.7). Every cloud route is also covered by 00's route-inventory and cross-tenant tests (D54, M25).

> ⚠️ Changed by 01c v1.0 (A16): numbered tests to rewrite or re-key for 01c: 4 (snapshot contents, schema 2), 41 (`group_label`), 59, 60, 61, 66, 67, 72, 73, 77, 89, 91, 93, 116, 128, 129, 130, 131, 132, 133, 134, 140 (statement bound ≤ 13 → ≤ 22), 143 and 145 (`BusinessDayOpened` v2 payload), 147, 148, 149, 152, 156, 157, 158, 166, 167, 171 (34 tests). Each keeps its number; 01c §11 names the build step that re-keys it. See 01c §4.5.

### 10.1 Cloud — config delivery and idempotency

| # | Covers | Case |
|---|---|---|
| 1 | §6.1, S4 | Both versions equal → `304`, empty body, exactly 1 SQL statement after the tenant guard's key lookup (query counter, §6.1) |
| 2 | §6.1 | `config_version` behind → `200`, `config.snapshot` parses with `BranchConfigSnapshotSchema`, `snapshot_hash` = sha256 of canonical JSON, `directory: null` |
| 3 | §6.1, S6 | `directory_version` behind only → `config: null`, directory equals `loadDirectory` output |
| 4 | §6.1, S22 | Snapshot contains only active rows and only this branch's routes, except: an archived station, an archived program and an archived tax class are present with `is_archived: true` (v0.6); an archived item and an item with no route at this branch are absent |
| 5 | §6.1 | Snapshot query count is fixed (≤ 13, v0.7) for 10 and 300 items |
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
| 39 | §6.16 | PUT route twice → same state; the first bumps once, the second changes nothing and bumps nothing (v1.0.2, S26); `{ station_id: null }` removes it; item absent from that branch's snapshot |
| 40 | §6.11 | Menu list: 6 statements (v0.7, §6.11) for 1 and 50 items on the page; routes only for allowed branches |
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
| 73 | §4.5 | `StockSet`, `StockAdded`, `BusinessDayOpened` (v0.7) and `ItemMade*` are pushed to staff sockets, not to station sockets; `BranchConfigApplied` is pushed to both |

### 10.5 Pages (S35)

Component tests run in the `apps/client` Vitest project (`environment: 'jsdom'`), rendering with `react-dom/client` and `act`.

| # | Covers | Case |
|---|---|---|
| 74 | §8.1, S40 N7 | `money.ts`: `"1,200"` → 120000, `" 1,200 "` → 120000, `"1,20,000"` → 12000000, `"1,2,3"` → 12300, `"1200.5"` → 120050, `"1.234"` / `"-1"` / `"abc"` / `"١٢٠٠"` → rejected |
| 75 | §8.1, S35 e | **Automated (numbered):** menu view: an item name containing `<img src=x onerror=…>` renders as text (no `img` element in the DOM). **Automated (page part, lint test):** any `dangerouslySetInnerHTML` in `apps/client` fails lint. **Also a runbook step (§11 step 29):** a scratch `dangerouslySetInnerHTML` makes `pnpm lint` fail |
| 76 | §8.1 | Form retry reuses its `Idempotency-Key`; a newly opened form gets a new one |
| 77 | §8.2 | Stock page saves every touched row (an edit back to the same number, or the row's Still right) and no untouched row, reuses `command_id` on retry, shows "Not counted today" for an item whose `level` is `not_counted` (S33, S41) |
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
| 91 | §4.5 | Catch-up: a staff socket gets `branch_config`, `availability` and `stock` (with `business_day`, `business_day_started_at`, and per item `set_at`, `unit` and `level`, v0.7); a station socket gets `branch_config` only; before any config, `branch_config` is null |
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
| 103 | S30, §6.19 | **Automated (numbered):** item turned off yesterday at 22:00, business day opened today at 05:00 (`OpenBusinessDay`, v0.7) → stock query `unavailable_since` = yesterday 22:00; turned off today at 06:00 → `unavailable_since` today 06:00; available item → `unavailable_since: null`. **Automated (page part, component test) and also a runbook step:** the page shows "Off since \<day\>" for the first case and no badge for the second |
| 104 | — | **Removed in v0.7** (`businessDayStartedAt` removed with the fixed business day start, S33; the day open is tested by 133, the "Not counted today" badge by 77 and 133's page part). Number not reused |
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
| 116 | S41 | `availableStock(state, item, dayStart, item)` for an item with `carries_over: false`: `set_at` before `dayStart` → 0 even with `on_hand 4`; `set_at` ≥ `dayStart` → `max(0, on_hand − reserved)`; `set_at` null → 0; `dayStart` null → 0. Hub: yesterday's count of 4 at 23:00, `OpenBusinessDay` at 09:00 the next day → stock query and catch-up `stock` part show `available 0` and `on_hand 4`; after a `SetPrecookedStock` of 4 → `available 4` |
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

### 10.5f Added in v0.7 (owner answers), v0.7.1 and v1.0 (review 2)

| # | Covers | Case |
|---|---|---|
| 128 | S44, §3.3, §6.14, §6.15 | Units: item with `stock_unit 'g'`, `sale_unit 'piece'`, `stock_per_sale_unit 250` → `201`, in the snapshot with the three fields; defaults → `'piece'`, `'piece'`, 1, `low_stock_threshold: null`, `carries_over: false` (all in the snapshot); `low_stock_threshold 1000` and `carries_over: true` → in the snapshot; equal units with `stock_per_sale_unit 2` → `400`; `stock_unit 'piece'`, `sale_unit 'g'` → `400`; `PATCH { sale_unit: 'g' }` alone onto a `'piece'` / `'piece'` row → `400` (merged row), nothing written; a unit change is audited with `before` / `after` |
| 129 | S14, S45, S44 | Engine unit: `{ on_hand 500, reserved 0, set_at T0, unit 'g' }` + `StockAdded 250 g` at T1 → `{ 750, 0, T0, 'g' }` (`set_at` unchanged); `StockSet 300 g` → `on_hand 300`, `set_at` its `recorded_at`; `countIsValid` is false and `availableStock` 0 when the entry's `unit` ≠ the day's stock unit; `saleUnitsAvailable(750, 250)` = 3, `(749, 250)` = 2; a `StockAdded` in `'piece'` onto a `'g'` entry leaves the entry unchanged and reports **one** invariant breach; the fold does not throw (⚠️ Changed by 03a v1.0, A-20 / 03a BF-13: was "throws and the fold leaves the state unchanged", v1.0, review 2 nit 1) |
| 130 | §6.17a, S45 | `AddPrecookedStock`: an item counted today → one `StockAdded`, `recorded_as: 'added'`, `on_hand` increased; an item counted before the day open (`carries_over: false`), never counted, or counted in another unit → one `StockSet { on_hand: quantity }`, `recorded_as: 'set'`; not in config → `404`; not stock-tracked → `422 STOCK_NOT_TRACKED`; duplicate `item_id` → `400`; without `manage-stock` → `403`; retransmit → identical response, `Idempotent-Replay: true`, no new events; forced COMMIT failure → `EngineState.stock` unchanged; nothing written for any entry when one fails |
| 131 | S41 | `carries_over`: item with `carries_over: true` counted yesterday at 23:00, day opened today at 09:00 → `availableStock` = `max(0, on_hand − reserved)`, stock query `level` not `not_counted`, no "Not counted today"; the same item with `carries_over: false` → 0 and `not_counted` |
| 132 | S46 | `stockLevel`: count not valid → `not_counted`; available 0 → `out`; threshold 1 000 and available 1 000 → `low`, 1 001 → `ok`; threshold null and available 1 → `ok`. The stock query carries `level`. **Automated (page part, component test) and also a runbook step:** the stock page's alert bar lists the `low` and `out` items and is hidden when none |
| 133 | §6.18a, S33 | `OpenBusinessDay {}` with no day open → one `BusinessDayOpened { business_date: hub local date, units }` (`units` has every stock-tracked item's three unit fields), `state.business_day = { business_date, opened_at: recorded_at, closed_at: null, units }`, `changed: true`, `reason: 'opened'`; again while it is open → no event, `changed: false`, `reason: 'already_open'`, same `opened_at`; restart → `business_day` equals its value before the restart (boot step 3 fold); retransmit → replay; without `manage-stock` → `403`; forced COMMIT failure → `EngineState.business_day` unchanged. **Automated (page part, component test) and also a runbook step:** with no day open (null or closed) the page shows the large Start day action above the rows, and one tap sends `OpenBusinessDay {}` and keeps the typed counts; a save answered `409 BUSINESS_DAY_NOT_OPEN` shows the action and, after the tap, re-sends with the same `command_id`; Close day asks for confirmation; "Not counted today" shows for a count from before the open |
| 134 | §6.17, §6.17a, S33, §9 | Before any `OpenBusinessDay`: `SetPrecookedStock` and `AddPrecookedStock` → `409 BUSINESS_DAY_NOT_OPEN`, no event, no `processed_commands` row; after the first open → `200` |
| 135 | S47, §3.3, §6.13–6.15 | Windows: item `availability_windows [{ 25200000, 46800000 }]` and a category window `[{ 79200000, 7200000 }]` (wraps) → `201` / `200`, in the snapshot sorted by `start_ms`, `end_ms`, `window_id` (two windows with the same start sort by end), audited inside the item's and the category's `before` / `after`; a PATCH replaces the set (old rows gone); `start_ms = end_ms` → `400`; `start_ms 25200001` → `400`; 5 windows → `400`; `86400000` → `400` |
| 136 | S47 | `inAvailabilityWindows`: `[]` → true at any time; `[07:00, 13:00)` → true at 07:00, false at 13:00 and 06:59; wrapping `[22:00, 02:00)` → true at 23:30 and 01:59, false at 02:00 and 21:59; `localTimeOfDayMs(nowMs, utcOffsetMs)` with offset +5 h gives the Karachi time of day whatever the runtime's time zone (run under `TZ=UTC`, v1.0) |
| 137 | S47, S30, §6.19 | `isOrderableByTime(item, category, hubNowMs, utcOffsetMs)` at hub time 14:00 (+5 h): item with window `[07:00, 13:00)` → false; item with no window in a category with `[12:00, 16:00)` → true; item inside its window in a category outside its window → false; at 12:59 vs 13:00 → true vs false. **Automated (page part, component test) and also a runbook step:** from §6.19's `items_meta` and `hub_time` (device clock set 3 h wrong), the stock page shows "Hours 07:00–13:00" for the first item only, and an item switched Off inside its window shows Off (Off wins) |
| 138 | §6.11, S48 | Menu pages: 120 items, `limit 50` → three pages of 50, 50, 20 in `(lower(name), item_id)` order, each item exactly once, `next_cursor` null on the last; an item created between pages with a name before the cursor never appears on a later page and no item repeats; an item renamed across the cursor between pages may repeat or be missed, and the page de-duplicates by `item_id` (review 2 nit 3); `q: "karahi"` matches name and `group_label` case-insensitively; `q: "50%"` matches only a literal `%`; `status: archived` → only archived items; `category_id` filters; `limit 201` or a garbage `cursor` → `400`; 6 statements for every page |
| 139 | §6.11, S8 | `can_edit_tenant`: owner with every branch → `true`; owner with `allowed_branch_ids = [A]` of A, B, C → `false`. **Automated (page part, component test) and also a runbook step:** the menu opens read-only (no save buttons, the info line) when it is false |
| 140 | §6.1, S48 | 5 000-item branch: the snapshot is built in the fixed statement count (≤ 13); with `Accept-Encoding: gzip` the `200` has `Content-Encoding: gzip` and decompresses to JSON whose hash equals `snapshot_hash`; the hub's poller applies it through real `fetch`; without the header the body is plain JSON; a `304` has no `Content-Encoding` |
| 141 | S44 | `parseQuantity` / `formatQuantity` (`@pos/domain`): `"1.5"` kg → 1500 g; `"0.25"` L → 250 ml; `"2"` pieces → 2; `"1.2345"` kg, `"-1"`, `"1.5"` pieces, `"abc"`, `"١"` → rejected; `formatQuantity(1500, 'g')` → `"1.5 kg"`, `(250, 'ml')` → `"0.25 L"`, `(3, 'piece')` → `"3"` |
| 142 | §6.18a, S33 | **Past midnight (v1.0):** day opened at 06:00 on 24 Oct and not closed; at 00:30 on 25 Oct `OpenBusinessDay {}` → no event, `changed: false`, `reason: 'already_open'`, `business_day` still 24 Oct 06:00; a count taken at 23:00 on 24 Oct still reads its `available` (non-carrying item); the stock query says `day_stale: true` (18.5 h > the default 16 h) but nothing changes until someone acts (test 146) |
| 143 | §6.18b, §6.18a, S33, S41 | **Close then open after the minimum gap (v1.0):** day opened at 06:00; at 10:00:00 (exactly `day_min_gap_hours` 4) `CloseBusinessDay {}` → one `BusinessDayClosed`, `closed_at` 10:00, `reason: 'closed'`; then `OpenBusinessDay {}` → a new day, `opened_at` 10:00; a `carries_over: false` item counted at 08:00 → `available 0`, `level 'not_counted'`; a `carries_over: true` item counted at 08:00 keeps its `available` |
| 144 | §6.18b, S33 | **Close within the minimum gap (v1.0):** day opened at 06:00; at 09:59 `CloseBusinessDay {}` → no event, `changed: false`, `reason: 'opened_recently'`; with `day_min_gap_hours` set to 2 in the snapshot → the same close at 09:59 succeeds; with the hub clock moved back to 05:00 → no event (negative age is recent); the same `command_id` retransmitted → the stored response with `Idempotent-Replay: true` |
| 145 | §6.18b, S33, §4.5 | `CloseBusinessDay` with a day open (≥ min gap) → one `BusinessDayClosed`, `closed_at` = its `recorded_at`, `openDayStartMs` null; then `SetPrecookedStock` and `AddPrecookedStock` → `409 BUSINESS_DAY_NOT_OPEN`, nothing written; `availableStock` 0 for a `carries_over: false` item and unchanged for a `carries_over: true` one; `CloseBusinessDay` again → no event, `reason: 'not_open'`; `OpenBusinessDay` → a new day; without `manage-stock` → `403`; retransmit → replay; forced COMMIT failure → state unchanged; `BusinessDayClosed` is pushed to staff sockets, not station sockets |
| 146 | S33, §6.19, §8.2 | **Forgotten close + safety prompt:** day opened at 09:00, not closed; at 01:00 the next day (16 h) the stock query says `day_stale: false`; at 01:01 → `true`; with `day_stale_after_hours` 20 → `false`. **Automated (page part, component test) and also a runbook step:** with `day_stale: true` the page shows "Yesterday's day is still open since 09:00. Close it and start a new day?"; **Close and start new day** sends `CloseBusinessDay` then `OpenBusinessDay` with two `command_id`s; **Keep this day open** hides it |
| 147 | S33, S15, §5.1 | **Replay and restart across a closed day:** log `BusinessDayOpened` (day 1), `StockSet 4` (non-carrying), `BusinessDayClosed`; restart → `business_day.closed_at` set, stock commands `409`, `availableStock` 0; then `OpenBusinessDay` → day 2 with a new `opened_at`, the day-1 count still 0; `buildEngineState(log)` equals the live state before and after the restart; the engine fixture (test 68) includes both events |
| 148 | S14, §4.4 03a | `canServeFromStock(available, quantity, stockPerSaleUnit)`: (1 000, 4, 250) → true; (999, 4, 250) → false; (100, 1, 250) → false; (300, 500, 1) → false (weighted line); (500, 500, 1) → true; (0, 1, 1) → false |
| 149 | S44, S33 | **Units frozen for the day:** day open with an item at `stock_unit 'piece'`, counted 6; a new snapshot changes it to `'g'` / `'piece'` / 250 → the stock query still shows `unit 'piece'`, `on_hand 6`, `available 6`, `stock_per_sale_unit 1`; `SetPrecookedStock` writes `unit 'piece'`; `dayUnits` returns the frozen triple; after `CloseBusinessDay` and `OpenBusinessDay` → `BusinessDayOpened.units` has `'g'` / 250, the count reads `not_counted` (`available 0`), and a new count is written in `'g'`. An item added to the menu mid-day uses its own snapshot units |
| 150 | §4.2, S44, S59 | v1.2 reworded. `lineTotalMinor`: (120000, 2, 'piece') → 240000; (220000, 1250, 'g') → 275000 (1.25 kg × Rs 2,200 = Rs 2,750); (145550, 1, 'g') → 100 (Rs 1.4555 → Rs 1); (150000, 1, 'g') → 200 (Rs 1.50 rounds half-up to Rs 2); (149000, 1, 'g') → 100; (240000, 1500, 'g') → 360000; (99, 250, 'ml') → 0 (24.75 paisa); (99999, 1500, 'ml') → 150000 (Rs 1,499.985 → Rs 1,500); a 1 000 000 000 × 1 000 000 product computes exactly (`BigInt`); a non-integer input throws |
| 151 | S47, §4.5, §6.23 | `hub_time`: the catch-up `branch_config` part and `GET /queries/branch-config` carry `{ now_ms, utc_offset_ms }` from the hub clock (fake clock at T, OS zone `Asia/Karachi` → `utc_offset_ms` 18 000 000); before the first config the catch-up part is still null |
| 152 | §6.19, S-5 | Stock poll: first read (no versions) → `items_meta` and `items`, 1 statement; again with both versions → `unchanged: true`, both null, 0 statements; after a `StockSet` → `stock_version` moves, `items` only (`items_meta` null), 1 statement; after a config apply → both; after `ItemMadeUnavailable` and `BusinessDayClosed` → `stock_version` moves; after a `BusinessDayOpened` → `meta_version` and `stock_version` move, both parts sent; restart → `stock_version` equals the last such event's `seq` |
| 153 | S8, §6.11, §6.12–6.15 | **Allowed branches read from the database:** owner logs in with A, B, C; `issue-registration-code` adds D (appending it to `owner_users`); with the **old** token, `POST /v1/admin/categories` → `201`, `can_edit_tenant: true`; an owner whose row lacks D (removed by SQL) but whose token still lists A–D → `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` and `can_edit_tenant: false` |
| 154 | §6.7, S33, S26 | `set-branch-settings --day-stale-after-hours 20 --day-min-gap-hours 2` → row updated, one `branch_settings` / `update` audit row, this branch bumped, both values in the next snapshot; a new branch's snapshot has 16 and 4; `--day-stale-after-hours 0` or `73`, `--day-min-gap-hours 25`, or `--day-min-gap-hours 20` with a stale setting of 16 (stale must be greater) → exit 1, nothing written; the snapshot schema rejects a missing field |
| 155 | S26, §6.4–§6.16 (v1.0.2) | **No-op writes:** a floor PATCH with its current name and sort order, and an item PATCH with its current fields and windows → `200` with the stored entity, no `config_audit` row, no `config_version` change; a route PUT with the stored route, and `{ station_id: null }` for an item with no route at that branch → `200`, no audit row, no bump; a PATCH that changes one field still writes one audit row and bumps once |
| 156 | §6.19, §8.2 (v1.0.2) | The stock query's `items_meta` carries `category_name`, and the answer carries `day_min_gap_hours` (the snapshot's value, or 4 with no config). **Page part:** the category filter options show the names; an `opened_recently` close shows "less than 2 h ago" when `day_min_gap_hours` is 2 |
| 157 | S46 (v1.0.2) | Threshold 1 000 g, day opened with the item in `piece`, then the config changes it to `g`: `stockLevel` is `ok` (not `low`) for a valid count below the threshold for the rest of that day, and still `out` at 0; after close and a new open (frozen `g`), a count of 500 g is `low` |
| 158 | §6.19 (v1.0.2) | With a day open, `items[].unit` is the frozen day unit even for an item never counted (no `'piece'` default); with no day open it is the config's `stock_unit`; a count recorded in `piece` while the day's unit is `g` is reported as `on_hand 0, reserved 0, set_at null` |

### 10.5g Added in v1.1 (design hand-off; renumbered by review 3)

All are `apps/client` component or unit tests (jsdom). Where a test names parts, each part is cited once (§12.1).

| # | Covers | Case |
|---|---|---|
| 159 | S49, §8.3 | Language: `?lang=ur` → `<html lang="ur" dir="rtl">` and `pos-lang` stored; a stored `en` wins over `navigator.language` `ur-PK`; no query and no stored value with `ur-PK` → Urdu, `en-US` → English; a key missing from `ur.ts` renders the English text; every `ur.ts` key exists in `en.ts`; `fill(t('owner.continue_with'), { branch: 'Gulberg' })` fills the placeholder in both languages; with `ur`, a heading with class `title` renders with `ur-title` |
| 160 | S50 e | Error text: every code in `ErrorCatalogue` (`@pos/domain`) and `network` map to a non-empty `t()` text that contains neither the code nor the server `message`; each `CONFIG_REFERENCE_INVALID` reason has its own text; a code not in the catalogue → `errors.UNKNOWN` |
| 161 | S50 b | **Component part:** the dialog traps Tab, closes on Escape and returns focus to its trigger. **Page part:** item, category, station, tax class and floor open a confirm dialog naming the thing, and Cancel sends nothing; a table or program archives at once, Undo within 8 s sends `archived: false`, the chip is gone after 8 s; Undo answered `409 CONFIG_NAME_TAKEN` shows the name-taken text; a `409 CONFIG_IN_USE` on archive shows the blocked dialog with the names ("and N more" for unresolved ids), and on a station type change its own text |
| 162 | S50 c | Dirty guard: a changed item form → Cancel, Back, a side menu item, the branch select and Sign out each open "Discard your changes to {name}?" listing the changed field labels; **Keep editing** keeps the values; **Discard changes** leaves; an unchanged form leaves with no dialog |
| 163 | S51 | Bulk add T1 … T12, 4 seats: 12 `POST`s in order with keys = form key + 0 … 11 and progress "Adding {i} of 12…"; T5 already in the loaded floors → nothing sent, T5 named; a network failure on the 5th stops the loop, **Add** again re-sends 5 … 12 with the same keys; after that failure, changing the floor renews the key (no `422 IDEMPOTENCY_KEY_MISMATCH`); a range of 101 is refused; a form key whose random part is all `Z` gives valid ULIDs (wraps modulo 2^80); the branch select is disabled during the loop |
| 164 | S52 | One allowed branch → no picker; with two, the pick survives a remount through `sessionStorage`; a stored id not in `allowed_branch_ids` is ignored; `#/menu` renders with no branch; the Floors app bar's branch select switches the branch; the item form's Kitchen section has one row per allowed branch, labelled with the ID tail |
| 165 | S53 | On the item form: a save fails with a network error → banner, Save disabled, typed price kept; (fake timers) the probe `GET` at 0.5 s fails, at 1 s succeeds → banner gone, Save enabled, typed price still 35, exactly one `PATCH` sent; a failed read is retried at 0.5, 1, 2, 4, 5, 5 s; the banner and disabled Save also show on Floors, Stations and Menu; on `#/login` the banner shows and **Sign in** stays enabled |
| 166 | S55 | Draft: typed counts written under `stock-draft:<branch>:<opened_at>:<staff>`; nothing written with no day open; the same staff and day after sign-in → rows restored as touched with the banner; another staff → nothing restored, draft kept; a `StockAdded` on a row after the draft was written → that row not restored as touched and listed as changed since; same `business_date` with a different `opened_at` → nothing restored, draft deleted; an entry in another unit, for an item no longer in `items_meta`, or no longer stock-tracked is dropped; deleted on a successful save and on Discard; a throwing `localStorage` is ignored |
| 167 | S56 | Carried-over rows (valid count, `set_at` before the day start): the callout shows their number; one row typed first; the tap sends one `SetPrecookedStock` with every carried-over row's shown `on_hand` and the typed row's typed value; the callout hides once none is untouched; 201 touched rows → two commands (200 + 1) with two `command_id`s; a failure of the second keeps its row touched and the retry reuses its `command_id` |
| 168 | S54 a, b | Rows show **Count** with **Still right**, **Left to sell** and **on orders**; the **Selling** switch has `role="switch"` and `aria-checked`; level filter counts and filtering, together with the category filter; a low chip tap focuses its row; the stale prompt shows **Close it and start today** and **Keep it open** |
| 169 | S50 a | Owner Sign out sends `POST /v1/auth/logout`, clears storage and shows login, also when the call fails; with an expired access token: one refresh, then the logout carries the **new** refresh token |
| 170 | S50 d, f, g, h | A floor rename shows **Saved** for 3 s; the Items tab shows no total while `next_cursor` is not null and the total once it is null; the branch picker shows no counts; at 390 px the item form is price-first with "On sale at 1 of 2 branches" as text (no switch); a route `PUT` failing after a successful `PATCH` shows the partial banner and **Save {branch} again** re-sends only that `PUT` |
| 171 | S54 c, d | Phone add sheet: +5 on a kg item sends `AddPrecookedStock` 5 000 g; sign-in: an empty roster shows the nobody text; a locked tile with 13 min 1 s left reads "Locked · 14 min"; `PIN_LOCKED_OUT` with `retry_after_ms` 61 000 reads 2 min; `PIN_INVALID` with `attempts_remaining` 2 shows it, with 3 does not; a network failure shows **Retry now**, which re-reads the roster; a session without `manage-stock` shows the `PERMISSION_DENIED` text |
| 172 | S54 e, f, g, h | Header shows the day chip, menu chip and "Signed in as {admin_name}"; a session written by `/admin` (keys only, no stock-page login) shows its name; **Sign out** sends `POST /admin/auth/logout` and leaves none of the five 00 keys in `sessionStorage`, also after an `ADMIN_SESSION_REQUIRED` answer; Sign out with touched rows asks first; at 1280 px the side menu links to `/admin#devices`, `#sessions`, `#lockouts` with Stock `aria-current`, at 390 px it is absent; offline shows "{n} counts waiting"; a save shows "{n} counts saved at {time}" |

### 10.5h Added in v1.2 (per-branch price, branch names)

173–177 are cloud integration tests (Docker Postgres); 178–179 are `apps/client` component tests (jsdom).

| # | Covers | Case |
|---|---|---|
| 173 | S57 b, d, §6.16 | Route PUT with `price_minor_override: 230000` → `200`, the route answers and stores it; one `item_route` / `route_set` row with `before.price_minor_override = null` and `after.price_minor_override = 230000`; that branch bumps once, no other branch. The same PUT again → no audit row, no bump (S26). `price_minor_override: null` → stored null, one row. `-1`, `1 000 000 001` and `1.5` → `400`; `{ station_id: null, price_minor_override: 100 }` → `400` |
| 174 | S57 b, §6.11, §6.14 | `POST /v1/admin/menu-items` with routes at A (`price_minor_override: 230000`) and B (none) → `201`, A's route answers 230000, B's null; `GET /v1/admin/menu` returns the same overrides on the item's routes |
| 175 | S57 c | Item `price_minor` 220000 routed at A with override 230000 and at B without: A's snapshot has `price_minor` 230000, B's 220000; PATCH the item to 240000 → A stays 230000, B becomes 240000; PUT A's override to null → A becomes 240000 |
| 176 | S58, §6.7b | `GET /v1/admin/branches` with a token for A and C → exactly A and C with their names and `status` (A `active`, C `pending_hub`), ordered by name; tenant B's branch never appears; 1 statement |
| 177 | S58, §6.7b | No or bad JWT → `401 JWT_INVALID`; a token whose `allowed_branch_ids` holds only an unknown id → `200 { branches: [] }` |
| 178 | S58 | Owner app: after login the picker tiles, the **Continue with** button and the Floors branch select show the names from `GET /v1/admin/branches`; when that read fails, the ID tails show and the pages still work |
| 179 | S57 e | Item form: each branch row has **Price here** (placeholder "Same: 650"); a sold row with "700" PUTs `price_minor_override: 70000`, cleared → `null`; on a new item the POST's route carries it; **Not sold here** disables the field; "7x" marks that branch row and sends nothing; a PUT refused with `400` marks that branch row (B03). Menu list: a route with an override shows the chip "{branch name} Rs 2,300", a route without none |
| 180 | S50 a (v1.3.1) | At 390 px the owner shell shows no bottom tab bar; **Menu** in the app bar opens the side menu in a `role="dialog"` overlay; Tab stays inside it, Escape closes it and focus returns to **Menu**; **Change password** and **Sign out** are reachable from it; selecting a menu item closes the overlay and navigates to it. At 1440 px the side menu shows with no Menu button |

### 10.5i Added in v2.2 (02a Tables v1.0, A-1)

| # | Covers | Case |
|---|---|---|
| 181 | A-1 | Create zone on an active floor → 201, branch bumped, audit row; on an archived / foreign floor → 422 `floor_id` |
| 182 | A-1 | Same zone name twice on one floor → 409 `CONFIG_NAME_TAKEN`; same name on another floor → 201 |
| 183 | A-1 | Table with a zone of another floor → 422 `zone_id`; moving a table to another floor without `zone_id` → `zone_id = NULL` |
| 184 | A-1 | Archive a zone → its tables' `zone_id` NULL in the same transaction; snapshot shows the zone `is_archived: true` |
| 185 | A-1 | Archive a floor with an active zone → 409 `CONFIG_IN_USE { used_by: { entity: 'zone' } }` |
| 186 | A-1 | Floors list returns zones and `zone_id` in 3 statements |
| 187 | A-1 | Sync poll 200 path: one statement more than v2.1; snapshot `snapshot_schema_version = 4` with `zones[]` and `zone_id` |
| 188 | A-1 | Hub with snapshot 3 stored, cloud on 4 → body treated as missing, full snapshot applied (S28 b) |


### 10.5j Added in v2.3 (02b Ordering v1.0, A-1)

| # | Ref | Test |
|---|---|---|
| 189 | A-1 | Zone with `routes` and `stock_items` → stored; PATCH with `routes` only replaces routes, keeps stock items; `[]` clears |
| 190 | A-1 | Route to an archived station or a foreign item → 422 `routes.N.…`; duplicate `item_id` → 400 |
| 191 | A-1 | Stock item with `sale_unit 'g'` or `requires_weighing` → 422 `stock_items.N.item_id` |
| 192 | A-1 | Snapshot V4 carries `zones[].routes[]`, `zones[].stock_items[]`, `items[].is_ready_item` |
| 193 | A-1 | Settings: `queue_auto_send_max_ms`, `zone_undo_ms`, `slow_item_threshold_ms`, `comp_reason_chips` written, range-checked, delivered |
| 194 | A-1 | `StockTransferredOut` moves `stock_version` and sends a stock frame; boot fold counts it |
| 195 | A-1 | Item form: "Ready item" checkbox round-trips `is_ready_item` |

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
| E1 stock AC1 count at start, update any time (counts and adds, S45) | 59, 60, 116, 130 |
| E1 stock AC2 manager view of countdown, with low/out alerts (S46) | 72, 77, 132 |
| E1 stock AC6 no count → 0 (full cook time); a count from an earlier business day → 0 unless the item carries over (S41) | 89, 116, 131 |
| E0 menu AC1 categories, archive | 32, 38, 120 |
| E0 menu AC2 fields (image deferred S13) | 33 |
| E0 menu AC3 stock time | 33, 35 |
| E0 menu edge: zero-price item valid | 88 |
| E0 menu AC7 archived items gone from ordering, kept in history | 38 |
| E0 menu AC8 tax class on every item | **Overridden** by S34 (tax class optional; branch `tax_enabled`): 31, 33, 107, 108, 120 |
| E0 availability AC1 toggle, reflected on ordering screens within 5 s | 69, 73, 90, 91 |
| E0 availability AC4 scheduled availability (**narrowed** by S47: time windows per item and category, no days of week) | 135, 136, 137 |
| E0 availability AC5 manual toggle vs schedule (**overridden** by S47: a manual Off always wins; a manual On does not override a window [ASSUMPTION, owner question 12]) | 137 |
| Windows evaluated on the hub's clock and time zone, never the device's (S47) | 136, 137, 151 |
| E0 menu AC4–6 variants, add-ons, combos | **01c** (S12) |
| E0 PIN AC1 duplicate PINs rejected | **Dropped** by 00 M27 (duplicates allowed; salted hashes make detection impossible). No 01a or 01b test |
| E2 AC9 parking order type | **02's** (S10: an order type with no table, identified by the car number, F §5.9); no 01a test |
| Owner config changes are traceable (T2 audit, "who changed a price") | 80–84, 105 (CLI) |
| Only an owner who covers every branch changes tenant-wide data, checked against the database (S8, D30) | 117, 153 |
| A cloud deploy that adds a snapshot field never freezes hubs (S27, S28) | 94, 95, 114 |
| A cloud restore never leaves hubs on a menu or staff list the cloud no longer has (S42) | 123 |
| Poll problems, including a failed apply, are visible on the hub (S29, S43) | 44, 50, 102, 115, 126 |
| E1 stock AC1 "start of service" / "Not counted today" uses the business day opened and closed by staff (S33) | 77, 133, 134, 142, 143, 144, 145, 146, 147 |
| Availability carried over between days is visible (S30, confirmed) | 103 |
| [ASSUMPTION] Sold-out vs cook-fresh at stock 0 (S32): stored and delivered here; behaviour in 02 / 03a | 106 |
| Tax rate resolved at bill close; tax only when `tax_enabled` and a tax class (S31, S34); an archived class stays resolvable (S22) | Carried to 05. 01a delivers the data: 4, 107, 108 |
| Client build and release: one app, entries per surface, kit-only styling, hub ships the build from the same commit, on site (S35, S39) | 15, 78, 79, 113, 125; release drill (§11 step 29) |
| `@pos/engine` and the root of `@pos/domain` stay browser-safe (S35 k) | 127 |
| Stock and sale units, integers in the smallest unit, kg / L in the UI; units frozen for the open day; a line served from stock only when the whole line fits; one line-total function (S44, S14) | 128, 129, 141, 148, 149, 150 |
| Day settings are data (`day_stale_after_hours`, `day_min_gap_hours`, P2, S33) | 144, 146, 154 |
| Owner menu of any size: search, pages, read-only start for a branch-limited owner; stock page polls with a version short-circuit (152); 5 000-item snapshot gzipped (S48, S8) | 138, 139, 140 |
| Owner and stock pages follow the design hand-off: Urdu, dialogs, bulk tables, kept counts, confirm all (v1.1, S49–S56) | 159–172 |
| Carried: `registerStationValidator` | 57, 124 |
| Carried: cloud `idempotency_keys` (M69) | 9–14, 122 |
| Carried: BYOD auto-revoke on staff exit (R14) | 51, 115 |
| Carried: staff/role admin, PIN, `directory_version` bump; owner lockout notice | 01b, reserved tests 01b #1–#3 and #4 (§12.5) |
| Carried: E6 roles AC5 (role assignments and permission changes in the audit log) | 01b, reserved test 01b #5 (§12.5) |

---

## §11. Build order

Each task is TDD (failing test first) and is one commit citing its sections. v0.6 keeps the task numbers; task 28 is removed. v0.6.1 adds test 127 to task 24. v0.7 keeps the numbers, adds its work to the existing steps and adds steps 12a, 30 and 31. The plan is re-baselined after the re-review (v1.0).

1. Spec 00 v1.2.1 editorial patch (docs only, S25) [§2, S25]
2. `@pos/domain`: append §9 codes to `errors.ts` and F §6.2; add `manage-stock` to `permissions.ts`; grant it to Owner and Manager in `default-roles.ts`; v0.7: `units.ts` (`parseQuantity`, `formatQuantity`) and `availability-windows.ts` (`inAvailabilityWindows`, `localTimeOfDayMs(nowMs, utcOffsetMs)`, `isOrderableByTime`), v1.0: `line-total.ts` (`lineTotalMinor`) and the day-setting defaults, root exports; tests 136, 141, 150, 137 (function part) [§9, S18, S44, S47]
3. `@pos/domain/hash`: move `canonicalJson`, `sha256hex` to `packages/domain/src/hash.ts` (subpath export in `package.json`), with `canonicalJson` throwing on `undefined`; hub `lib/hash.ts` re-exports them; existing hub hash and command tests still pass; test 114 (unit part) [S27]
4. `@pos/events`: `config.ts` (`SNAPSHOT_SCHEMA_VERSION = 1`, `BranchConfigSnapshotSchemaV1` with `is_archived` on programs and tax classes, not `.strict()`, S28), `BranchConfigApplied.v1`, `StockSet.v1` (with `unit`), `StockAdded.v1`, `BusinessDayOpened.v1`, `ItemMadeUnavailable.v1`, `ItemMadeAvailable.v1`, fixtures and builders; the v0.7 item and category fields [§4.2, §4.3, S22, S44–S47]
5. `packages/engine` (new package, F §6.9 folder): `state.ts`, `stock.ts` (`countIsValid`, `availableStock` with the business-day and `carries_over` rule, `stockLevel`, `saleUnitsAvailable`, the `≥ 0` invariant), `apply-event.ts` (`StockSet`, `StockAdded`, `BusinessDayOpened`), `version.ts`, fixture `engine-state.v1.json`; v1.0: `openDayStartMs`, `dayUnits`, `canServeFromStock`, `BusinessDayClosed` in the fold; tests 66, 68, 116 (unit part), 129, 148 [S14, S15, S33, S41, S44–S46]
6. Cloud migration `0002_restaurant_setup.sql`, including `config_audit` and its trigger, `branches.tax_enabled`, `menu_items.out_of_stock_behaviour`, the v0.7 item columns, `availability_windows`, `menu_items_name_order`, nullable `tax_class_id`, `config_audit.actor_kind`; test 84 [§5.2, S26, S32, S34, S41, S44, S46, S47]
7. Cloud `lib/idempotency.ts` (`withIdempotency`, request hash over method, path and body, prune after COMMIT); tests 9–14, 122 [S7]
8. Cloud `bumpConfigVersion` (S8 lock order, tenant-wide coverage check reading `owner_users.allowed_branch_ids` at write time, v1.0) and `lib/config-audit.ts` (`writeConfigAudit`); tests 7, 8, 153 (write part) [S8, S26]
9. Cloud `modules/restaurant`: floors and tables §6.2–6.6, with audit rows; tests 16–23, 80, 83, 118 [§6 batch 1, §6.0]
10. Cloud stations and programs §6.8–6.10; tests 24–30, 86, 119 [§6 batch 2]
11. Cloud tax classes, categories §6.12–6.13 (category windows); tests 31, 32, 120, 135 (category part) [§6 batch 3, S47]
12. Cloud menu items and routes §6.14–6.16 (merged-row validation, units, threshold, `carries_over`, item windows); tests 33–39, 41, 81, 82, 87, 88, 106, 107, 117, 121, 128, 135 (item part) [§6 batch 3, §3.3, S8, S32, S34, S41, S44, S46, S47]
    - 12a. Cloud owner menu read §6.11 (search, keyset pages, `can_edit_tenant`); tests 40, 138, 139 (server part), 153 (`can_edit_tenant` part) [§6.11, S8, S48]
13. Cloud `modules/config-sync`: `GET /v1/sync/config` with `builder.ts`, the wire hash and the `REPEATABLE READ` transaction; gzip of the `200`; tests 1–6, 85, 114 (cloud part), 140 [§6.1, S4, S27, S28, S48]
14. Cloud CLIs `cli/set-branch-settings.ts` (`--tax-enabled`, v1.0 `--day-stale-after-hours`, `--day-min-gap-hours`) and `cli/restore-bump.ts`; tests 105, 108, 123 (cloud part), 154 [§6.7, §6.7a, S34, S42, M56]
15. Hub migration `0004_restaurant_config.sql`; projections `branch-config.ts`, `item-availability.ts` (times from `recorded_at`); test 49 [§5.1]
16. Hub `sync/config-poller.ts` (`pollOnce`, apply, swap, `onBranchConfigApplied`, S43 failure path), boot step 6 timer; `QueryCtx.state` / `.branchConfig`; raw-JSON hash before parse, one schema version, forward-only rule, `last_problem`; tests 42–47, 50, 53, 54, 58, 94, 95, 115, 126 [§3.4, S5, S6, S16, S28, S29, S43]
17. Hub body-missing path (`BODY_MISSING`); directory-through-poll tests 48, 51, 52, 123 (hub part) [S5, S6, S42]
18. Hub `sync/station-validator.ts`; test 57 [§6.22]
19. Hub boot: `BootContext.initialState`, `createDeps` takes it, `state.setReducer(applyEvent)` at `lib/boot.ts:279`, boot step 3 fold (stock and business day), boot step 5 config load; tests 67, 93, 124 [S15, S33, §2]
20. Hub `SetPrecookedStock` (a `StockSet` with `unit` for every entry; `BUSINESS_DAY_NOT_OPEN`); tests 59–65, 134 [§6.17, S33]
21. Hub `SetItemAvailability`, `itemAvailability`; tests 69–71 [§6.18]
22. Hub queries stock and config status (`level`, business day, `day_stale`, v1.0: config and stock parts with `config_version` / `stock_version` short-circuit, `hub_time`); tests 56, 72, 89, 102, 103, 116 (hub part), 131, 132, 146 (server part), 152 (server parts) [§6.19, §6.21, S29, S30, S33, S41, S46, S47]
23. Hub WS audiences and catch-up parts (v0.7: `StockAdded`, `BusinessDayOpened`; `business_day`, `unit` and `level` in the `stock` part; v1.0: `BusinessDayClosed`, `hub_time` in `branch_config` and §6.23), `GET /queries/branch-config`; tests 73, 90, 91, 92, 151 [§4.5, §6.23, S46]
24. `apps/client` scaffold: `package.json` with the closed S35 g list, `vite.config.ts` (one mode per entry, `assetsInlineLimit: 0`, manifest on), two entry `index.html` files, `src/app/` hash routes, `ui-kit.ts` and `ulid.ts`, the jsdom Vitest project, ESLint rules from S35 d, e and f, and the browser-safe block for `packages/engine` and `packages/domain` (S35 k); root `pnpm test` builds first; root `engines.node` raised to `>=22.22.2 <23` (jsdom, S35 g); tests 75 (page part: lint), 79, 113, 125, 127 [S35, S39 a]
25. `client-dist` helper (hub + cloud, path from S39 b, bodies in memory, CSP on both), cloud `/owner/*` allowlist; `apps/hub/deploy/ship-client.sh` (§7.8, refuses while the hub is active); tests 15, 78 [§7.1, §7.8, S21, S35, S39]
26. Owner app: login, floors, stations, menu (v0.7: units, threshold, keeps overnight, hours, search, Load more, read-only start), `money.ts`, `api/cloud-admin.ts`; tests 74, 75, 76, and the page part of 139 [§8.1]
27. Hub `/admin/stock` app with the admin login from the shared `StaffTiles` and `PinPad` (S35 i), the status line and problem banner, touched-row save with Confirm, "Off since", `api/hub-admin.ts`; v0.7: business-day line and banner, Add per row, alert bar, units, hours badge, search and category filter; v1.0: Start day, Close day, stale-day prompt, polling with versions, hours from `hub_time`; tests 77, and the page parts of 102, 103, 132, 133, 137, 146 [§8.2]
28. **Removed in v0.6** (directory resend on epoch change, S36).
29. Manual runbook: owner creates a branch menu; hub pulls it; KDS pairs to a station; manager sets stock offline (internet unplugged); a count from yesterday shows Available 0 after the business-day start; cloud restore drill: restore an older cloud dump, see the hub ignore it, run `restore-bump`, and see the hub apply the older menu and the older staff directory; release drill: §7.8 steps 1–6 on site against a hub checkout (the pilot mini PC or any `ssh` target on the LAN), including one refusal (dirty tree, hub still active, or different commit); the page parts of tests 75, 102, 103, 132, 133 and 139, which are also automated (S40 N11): a scratch `dangerouslySetInnerHTML` fails `pnpm lint`; the stock page's danger banner; "Off since" and "Not counted today" badges around a day open; the low/out alert bar; the Start day action, Close day, and the stale-day prompt after a night with no close; the read-only menu for a branch-limited owner; v0.7: a kg count and an Add on the stock page; a breakfast window seen from the stock page before and after its end; a 5 000-item seed menu paged and searched on the owner page and pulled by the hub; and the §7.5 timings (S40 N10) [§10.6, S39, S40, S41, S42, S44–S48]
30. Hub `AddPrecookedStock` (§6.17a); tests 130 [S45]
31. Hub `OpenBusinessDay` and `CloseBusinessDay` (§6.18a, §6.18b; open → closed; `day_min_gap_hours` guard; units frozen at the open); tests 133 (server part), 142, 143, 144, 145, 147, 149 [S33, S44]
32. v1.2 (plan tasks 81–84): cloud per-branch price (migration `0004_branch_price.sql`, route bodies and responses, effective price in the snapshot; tests 173–175) [S57]; `GET /v1/admin/branches` (tests 176, 177) [S58, §6.7b]; `lineTotalMinor` to the nearest whole rupee (test 150) [S59]; owner app branch names, **Price here** and the menu chip (tests 178, 179) [S57 e, S58, §8.1]
33. ⚠️ Changed by 03a v1.0: **v2.1 is built by the 03a build** (03a v1.0 §11 tasks; its plan `docs/plans/03a-plan.md`): migration `0007_engine_config.sql`, the station / item / category route fields, §6.9a points, snapshot schema 3 with its re-baselined builder bound (01b v1.5 B-8), the stock-command drafts (A-14), `stock_version` (A-17) and A-20 [§5.2a, §6.8–§6.9a, §6.13, §6.15, §6.17–§6.19, §4.3].

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done
- Every numbered test 1–180 except those **removed** (v0.6: 55, 96–101, 109–112; v0.7: 104) is cited by exactly one test, or (S40 N11, extended in v1.0 by review 2 nit 10) by one test per named **part** ("unit part", "hub part", "page part", "category part", …), each part cited once; all pass in CI (hub SQLite, cloud PostgreSQL 16). No test cites a removed number.
- Route-inventory and cross-tenant tests pass with the new routes and the `config_audit` table (D54).
- Every owner config write in §6.0 writes its `config_audit` row in the same transaction (tests 80–84).
- Spec 00 v1.2.1 editorial patch applied (S25). Spec 00 needs **no** behaviour change (v0.6: S36 and its 00 v1.3 entry are withdrawn).
- §9 codes are in `errors.ts` and F §6.2; `manage-stock` is in the catalogue and the default roles.
- README updated: module map (01a, 01b, 01c), milestones (01b before the first live order; 01c before 02; target 2027-02-28), product direction and owner answers (R18–R20), requirements carried (§4.4), 00 drift notes (§2).
- Runbook (task 29) done on the dev box: a cloud menu edit reaches the hub within 60 s; a day is opened before the stock count; a KDS pairs to a station; stock entry works with the internet down; the restore drill with `restore-bump` reaches the hub; the release drill (§7.8) ends with `/admin/stock/` → `200` with the CSP header on the hub.
- The cloud restore runbook (06 / ops) includes `restore-bump` and the re-apply of staff changes made after the backup (S42).
- **Dependencies:** none new in `apps/hub`, `apps/cloud` or `packages/*`, except the dev-only `@types/node` 22.19.1 in `packages/domain` for `hash.ts` (S27, S40 N1), and the workspace dependency `@pos/engine: workspace:*` in `apps/hub` (and in `apps/client`, S35 f), which is a workspace package, not a new library. In `apps/client` only, the closed, pinned list of S35 g: `react`, `react-dom` (runtime), and `vite`, `@types/react`, `@types/react-dom`, `jsdom` (dev); no router, state, form or CSS library. CLAUDE.md's "no extra dependencies" rule is met by this recorded decision. Root `engines.node` is `>=22.22.2 <23`.
- Build and release (S39, §7.8): `ship-client.sh` exists; the hub and cloud serve `apps/client/dist/<entry>/` with the CSP header; the deploy notes in §7.8 are the release procedure (on site, outside service hours).

### 12.2 Endpoint checklist

| # | Route / command | Auth | Permission | Idempotency | Tests |
|---|---|---|---|---|---|
| 6.1 | `GET /v1/sync/config` | branch key | — | read | 1–6, 85, 114, 140, 175 |
| 6.2 | `GET /v1/admin/branches/:b/floors` | JWT | owner | read | 16 |
| 6.9a | `POST` / `PATCH /v1/admin/branches/:b/points` (⚠️ v2.1, 03a A-1) | JWT | owner | `Idempotency-Key` on `POST`; `expected_version` on `PATCH` | 03a §10 (points cases; `route-cases.ts` C7) |
| 6.3 | `POST …/floors` | JWT | owner | key | 16, 17, 80, 83, 122 |
| 6.4 | `PATCH …/floors/:id` | JWT | owner | PATCH | 17–19 |
| 6.5 | `POST …/tables` | JWT | owner | key | 20, 21 |
| 6.6 | `PATCH …/tables/:id` | JWT | owner | PATCH | 22, 118 |
| 6.6a | `POST …/zones` | JWT | owner | Idempotency-Key | 181, 182 |
| 6.6b | `PATCH …/zones/:id` | JWT | owner | PATCH | 184, 185 |
| 6.8 | `GET …/stations` | JWT | owner | read | 24 |
| 6.9 | `POST` / `PATCH …/stations` | JWT | owner | key / PATCH | 24–27, 82, 86 |
| 6.10 | `POST` / `PATCH …/programs` | JWT | owner | key / PATCH | 28–30, 87, 119 |
| 6.7b | `GET /v1/admin/branches` | JWT | owner | read | 176, 177 |
| 6.11 | `GET /v1/admin/menu` | JWT | owner | read | 40, 138, 139, 174 |
| 6.12 | tax classes `POST` / `PATCH` | JWT | owner covering every branch | key / PATCH | 31, 117, 120 |
| 6.13 | categories `POST` / `PATCH` | JWT | owner covering every branch | key / PATCH | 32, 82, 117, 120, 135 |
| 6.14 | `POST /v1/admin/menu-items` | JWT | owner covering every branch | key | 33–37, 41, 87, 88, 106, 107, 117, 128, 135, 174 |
| 6.15 | `PATCH /v1/admin/menu-items/:id` | JWT | owner covering every branch | PATCH | 38, 81, 117, 121, 128, 135 |
| 6.16 | `PUT …/routes/:branch_id` | JWT | owner | PUT | 39, 82, 86, 173, 175 |
| 6.17 | `SetPrecookedStock` | admin session | `manage-stock` | `command_id` | 59–65, 134 |
| 6.17a | `AddPrecookedStock` | admin session | `manage-stock` | `command_id` | 130, 134 |
| 6.18 | `SetItemAvailability` | admin session | `manage-stock` | `command_id` | 69, 70, 90 |
| 6.18a | `OpenBusinessDay` | admin session | `manage-stock` | `command_id` | 133, 142, 143, 145, 147, 149 |
| 6.18b | `CloseBusinessDay` | admin session | `manage-stock` | `command_id` | 143, 144, 145, 146, 147 |
| 6.19 | `GET /admin/queries/stock` | admin session | `manage-stock` | read | 72, 89, 103, 116, 131, 132, 146, 149, 152 |
| 6.20 | — | — | — | — | removed in v0.6 (S24) |
| 6.21 | `GET /admin/queries/config-status` | admin session | `access-hub-admin` | read | 56, 102 |
| 6.23 | `GET /queries/branch-config` | staff or station session | — (any session) | read | 92, 151 |

CLIs (not endpoints): `set-branch-settings` (§6.7) tests 105, 108, 154; `restore-bump` (§6.7a) test 123.

### 12.3 Open questions (developer)
| # | Question | Blocks |
|---|---|---|
| Q1 | **Closed in v0.7 (S38):** stock counting becomes an assignable responsibility in 01b; until then `manage-stock` plus `access-hub-admin`. | — |
| Q2 | **Resolved in v0.2 (S25).** Behaviour is identical, so spec 00 is patched editorially to v1.2.1 to match the code (exact lines in S25). `QueryCtx.state` / `.branchConfig` stay 01a's own additive change (S16). | — |
| Q3 | **Closed in v0.4 (S37):** `GET /v1/admin/branches` is 01b's (§12.5); until then the branch picker shows IDs. | — |
| Q4 | **Closed in v0.4, re-decided in v0.6 (S42):** after a cloud restore, `restore-bump` raises `tenants.directory_version`, so every hub takes the restored directory under the unchanged M51 rule. The restore runbook re-applies staff changes made after the backup. | — |
| Q-v2.1-1 | **Answered 2026-11-03 (developer).** ⚠️ New in v2.1 (03a v1.0 A-1): the error for an unknown `point_id` in the §6.9a path → `404 POINT_NOT_FOUND`, appended to §9, foundation §6.2 and `@pos/domain/src/errors.ts` in the 03a build (no bump, R34) | — (built by the 03a plan's points task) |
| Q-v2.1-2 | **Answered 2026-11-03 (developer).** ⚠️ New in v2.1 (03a v1.0 A-1, A-2): archiving a point that an active station names is refused → `409 CONFIG_IN_USE { entity: 'point', id, used_by: { entity: 'station', ids } }` (the active stations' ids), as for a floor with active tables (§6.4); no new code | — (built by the 03a plan's points task) |

### 12.4 Deferred until needed
| Item | Trigger |
|---|---|
| Floor canvas, table shape, `pos_x` / `pos_y` (S9) | Owner asks for a visual map after the pilot |
| Item images (S13) | Owner asks for photos on screens or a customer menu (P2 E9) |
| Optimistic concurrency on owner PATCH (S23) | More than one person edits the menu |
| `config_snapshots` pruning | Hub disk use from snapshots > 1 GB, or 03a's checkpoint makes old bodies unreachable |
| Shared `client-dist` helper between hub and cloud (§7.1) | The two copies differ in a bug fix |
| Price lists (E0 P2; v1.2: a single per-branch price is built, S57) | More than one price per branch (time of day, order type) |
| Large-menu CPU work off the hub's main thread (`worker_threads` for snapshot hash and parse, S48 d; review 2 S-5) | **Any branch snapshot over 1 000 items** (checked by the poller, which logs a `warn` once per apply above it) |
| Days of week on availability windows (S47; E0 availability AC4) | Owner asks for weekday-only items (e.g. Friday specials); an optional `days` field is added to the window rows and the snapshot (S28 c) |
| A user-built workflow or rules engine (P1) | Never by default; only if settings cannot express a real restaurant's need |
| Windows hub install path (P3) | README "later"; a restaurant without a Linux box |
| Bulk table create endpoint (v1.1: the page loops §6.5, S51) | More than one new branch to set up |
| Warn about in-flight tickets when a station is archived (E1 floors AC6, edge case) | **Owned by 03b** (§4.4): the hub sees tickets, the cloud does not. Built with 03b's KDS through `onBranchConfigApplied` |
| Read endpoint and owner page for `config_audit` (S26) | Owner asks "who changed this price"; until then it is answered with a SQL query on the cloud database |
| Snapshot schema negotiation between cloud and hub versions (S28 b/e, cut in v0.6) | Hubs can no longer be upgraded together with the cloud (more tenants, remote updates, milestone C) |
| "Get changes now" button (`pull-now`, S24, cut in v0.6) | The owner asks for menu changes faster than the 60 s poll |

### 12.5 01b and 01c scope lists (neither written in this draft)

> ⚠️ Changed by 01b (B13): this list is now specified by 01b v0.4; idle TTLs are per role, not restaurant settings. See 01b §4.4.

**01b — Staff and role admin.** Required for milestone A, before the first live order (S2); built alongside 02.
- Cloud roles from the permission catalogue (list, create, edit, archive); E6 AC1, 2, 5 (audit of role changes), 7 (last `access-hub-admin` guard, 00 M57; owner cannot remove their own admin access).
- Staff CRUD, staff-to-branch assignment (`staff_branches`), `is_active` for exit (exit → removed from the directory → 01a's poll ends sessions and revokes the BYOD phone, 01a test 51).
- PIN set/reset: 4–6 digits sent over HTTPS, hashed with argon2id **on the cloud** at 00 M8 parameters or stronger, never a hash the hub would skip under M52. This overrides D40 / F §3.1 "hashed on the setting device" and must be recorded in 01b as a named decision. PIN reset ends sessions through M50.
- `tenants.directory_version` bump on every staff/role change (00 M51), strictly upward; `restore-bump` (01a S42) raises it after a cloud restore.
- Audit staff removals and PIN resets, so the restore runbook can re-apply them after `restore-bump` (S42).
- Out-of-band owner lockout notice (00 M73): dashboard notice on the next successful login, plus e-mail if a sender exists.
- **`GET /v1/admin/branches` moved to 01a in v1.2 (§6.7b, S58).** **`PATCH /v1/admin/branches/:branch_id/settings { tax_enabled? }`** (v0.7: `business_day_start_ms` is removed, S33): owner-only, common write script, `config_audit` row `branch_settings` / `update` (`actor_kind 'owner'`), bump that branch (01a §6.7, S34), plus a branch settings view. Staff/role owner views in the `apps/client` owner entry (S35); `withIdempotency` on creates.
- **Owner answers (v0.7):** permission **scopes** (a permission limited to the person's own tables or to a floor); assignable **responsibilities** (e.g. stock counting for a station; replaces S18's interim rule, S38); **no role-named behaviour** (R5, P1); **session idle TTL defaults** stored in restaurant settings and editable by the owner (P2). *v1.3: 01b v0.3 makes them per role (01b B13).*
- **Reserved 01b test numbers for carried items:** 01b #1 role CRUD from the catalogue + last-admin guard; 01b #2 staff CRUD + branch assignment + `directory_version` bump; 01b #3 PIN set/reset produces an M8-valid argon2id hash that 00's `applyStaffDirectory` accepts (not skipped under M52) and ends sessions (M50); 01b #4 locked owner account → notice shown on the next successful login (M73); 01b #5 E6 roles AC5: every role create/edit/archive, permission change and role assignment writes one audit row in the same transaction, with actor, before and after.
- Not in 01b: E0 PIN AC1 (duplicate PINs rejected) is dropped by 00 M27. Duplicates are allowed, because salted hashes make detection impossible. Modifiers, combos and scheduled availability are no longer 01b's (01c, S12; time windows in 01a, S47).

**01c — Menu (v0.7, new spec).** In pilot scope. Written right after 01a and **before 02**, because it shapes the `OrderPlaced` line (S1, S12). Builds on 01a's items, routes, units (S44), stock (S14, S41) and windows (S47), and on 01a's config delivery (a schema-1 addition or a coordinated new schema version, S28).
- **Variants:** sizes, half/quarter, and **weighted items** (sold by g or ml, S44); per-variant price, and per-variant cook time, route and stock where they differ.
- **Modifier groups:** extras and sides as categories of choices; each option paid or free; min/max choices per group; a group attached to items or categories.
- **Deals / combos:** a fixed price for a set of parts; **each part is routed to its own station** (its own route, cook time and stock), so the kitchen sees the parts, not the deal.
- Replaces or keeps 01a's `group_label` (S12); owner menu pages as views of the `apps/client` owner entry (S35); settings as data (P2).
- Defines what 02's order line carries for a variant, its modifiers and a deal's parts (D25 copies).

### 12.6 Owner questions still open (v0.7)
v1.2: answered and removed: 5 (per-branch price, S57), 10 (batch is chosen per item in the item form; owner data, nothing to build), 13 (g / ml lines to the nearest whole rupee, S59).
Answered on 2026-10-25 and removed: 1 (parking → 02, S10), 2 and 6 (extras, sizes, deals → 01c, S12; menu size → S48), 4 (`carries_over` per item, S41; Off carries over, S30), 7 (tax optional, by bill type and payment method → 05; PRA deferred, S31, S34), 8 (stock counting is an assignable responsibility, 01b, S38), 9 (time windows, S47), 11 (business day from the day open, S33), and the counting unit in 3 (units, S44). Each remaining question names the decisions that wait on its answer; none blocks 01a's build.
3. When the paye or another pre-cooked pot runs out, is the item sold out for the day, or do you cook more? Which items are which? (S32)
12. If an item is switched **On** by hand outside its time window (e.g. breakfast at 14:00 for one customer), should it be sellable, or should the owner change the window? (S47 [ASSUMPTION]: the window wins)

### 12.7 Assumption isolation (v0.7)
Each remaining [ASSUMPTION] and the one place a different owner answer changes. v0.7 removed the rows answered by the owner (parking, modifiers, `carries_over`, Off carry-over, tax, who counts, business day start).

| Assumption | Owner question | The one place that changes |
|---|---|---|
| `out_of_stock_behaviour` (S32) | 3 | The column default; if every item is `cook_fresh`, nothing else changes (02 and 03a already branch on the value) |
| Pilot menu under 200 items, so one `GET /v1/admin/menu?limit=200` resolves the item names of a `CONFIG_IN_USE` (v1.1, S50 b) | — | S50 b: past 200 items the dialog shows more ids as "and N more"; the fix is paging that read |
| `stock_per_sale_unit` when stock and sale units differ (S44, decided in v0.7, not asked) | — (confirm at the next visit) | The item column and `saleUnitsAvailable`; 03a's reservation multiplies by it |
| 5 000 items as the design size (S48) | — (from "unbounded") | §7.5 targets and the §12.4 pruning and off-thread triggers; no code bound exists |
| A manual On does not override a time window (S47) | 12 | `isOrderableByTime` and its callers' precedence (hub SubmitOrder in 02, the stock page); one line |
