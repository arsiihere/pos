# 01c UI contract (owner app views, deferred)

Status: **requirements only, not built in 01c** (AD-35, developer 2026-10-30). Plan tasks 34–37 and tests #115 and #124 are deferred to a later UI module that maps 00 / 01a / 01b / 01c onto the new "Pulse" design in one pass. That module implements everything below. No owner-app view is built or restyled in 01c.

Authority: `docs/specs/01c_Menu_Variants_Spec_v1.0.1.md` (cited "§n"), mainly §8. Where the spec is silent, the source is the status board `docs/plans/01c-status.md` (cited "AD-n"). A line marked **spec: none — developer-listed** has no §8 rule; it records only what the developer asked to keep, and adds no rule of its own. If this file and the spec ever differ, the spec wins.

Surface: owner app `apps/client`, entry `owner` (01a S35; §8 heading). The hub stock page `/admin/stock` (§8 "Stock page (hub)") was built in 01c task 20 and is **not** part of this contract.

---

## 1. Cross-cutting rules (every 01c view)

- **Versions.** Every versioned form keeps the `version` it loaded and sends it (`expected_version`) (§8 "Versions"; §6.2, §6.8, §6.9, §6.12, §6.12a, §6.15, §6.16 bodies). Items carry no version: last write wins (§6.5, S23, V13).
- **409 CONFIG_STALE.** Show "Changed elsewhere — reload". Keep the user's draft so it can be copied. Never retry blind (§8 "Versions"). The `entity` values are `variant_group`, `stock_item`, `stock_item_branch`, `modifier_group`, `modifier_group_branch`, `deal`, `deal_branch` (§9).
- **Ids and Restore.** Forms send `option_id` / `deal_part_id` for existing rows and nothing for new rows (§8 "Ids"; §6.11 and §6.14 POSTs carry no ids, else `400`). Rows the form leaves out are archived (§6.12 and §6.15 edges "Omitted … archived"). List "Removed" rows under the form with **Restore**. Restore sends the archived id, which comes back with the same ULID (§8 "Ids"; §6.12 edge "An archived option's own id"; §6.15 "restored by its id"). The restore source is `archived_options: [{ option_id, name }]` / `archived_parts: [{ deal_part_id }]` on the wire (§5.4).
- **Archived lists.** `GET` takes `status?` ∈ `active` (default), `archived` on stock items (§6.6) and modifier groups (§6.10). Deals take it too (AD-30 a, developer Q-7), so archived deals can be listed for restore. Variant groups come whole, archived included, in the §6.3 menu read.
- **Read-only.** With `can_edit_tenant: false`, the tenant-level views open read-only (01a §8.1 rule). Branch rows stay editable for allowed branches (§8 "Read-only"). `can_edit_tenant` is returned by §6.6, §6.10 and §6.13. Tenant-level writes need an owner who covers every branch (§6.0), else `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }` (§6 shared failures).
- **Allowed branches only.** `branches` arrays list only the owner's allowed branches (§6.6, §6.10, §6.13; §5.4 modifier group wire).
- **422 field paths.** Map `422` `field` paths to the row as sent: `options.N…` and `parts.N.choices.M…` (§8 "Errors"). N and M are indexes into the sent list. On a restore without the list, they are indexes into the stored active rows in wire order (§6.12 R6; AD-31 a).
- **Idempotency.** Every creating `POST` (§6.1, §6.7, §6.11, §6.14) needs an `Idempotency-Key`. A retry with the same key replays the stored `201` (§6 intro; §6.1 edge). Branch PUTs take no key (§6.9, §6.12a). The 01a form-retry rules (S35 j, S53) still apply.
- **No-op saves.** A merged row equal to the stored one answers `200` with the stored entity and writes nothing (S26, §6 C4 step 5).
- **Body with only `expected_version`** → `400` (C9; §6.2, §6.8, §6.12, §6.15 edges). Only send a PATCH when something changed.

## 2. Item form (changed; §8 "Views", §6.3–§6.5, m7, N9, V18)

Wire: `GET /v1/admin/menu` (§6.3) adds `variant_groups` (whole, archived included) and, per item, `variant_group_id`, `variant_name`, `stock_draws`. It drops `group_label`, `stock_unit`, `stock_per_sale_unit`, `low_stock_threshold`, `carries_over`. `q` also matches the group name. The item wire adds `requires_weighing` (§5.4). `POST` / `PATCH /v1/admin/menu-items` bodies add `variant_group_id?`, `variant_name?`, `stock_draws?: [{ stock_item_id, quantity_per_sale_unit }]` (0–1), `requires_weighing?` (§6.4, §6.5).

- **Variant section:** a group picker and a variant name (§8). `variant_name` is 1–30 characters and required exactly when a group is set (§3.3). To leave a group, send `{ variant_group_id: null, variant_name: null }` together. Sending only one of them as null → `400` (§6.5 edge). The item's category must equal the group's (`422 category_mismatch`, §3.3).
- **Stock section:** a stock item picker and "uses per sale" shown in **the stock item's unit** through `parseQuantity` / `formatQuantity` (§8; 01a S44). Unit rule: equal units → quantity 1; different units → the item's `sale_unit` must be `piece`, quantity 1 … 1 000 000 (V4). Otherwise `422 unit_mismatch` at `stock_draws.0.stock_item_id` (§6.4 edge).
- **"Weighed when served" switch** (`requires_weighing`): show it only for kg / L items (`sale_unit` `g` / `ml`). Turning it on hides the Stock section (§8; V18).
  - A weighed item with a draw → `422 weighed_item_stock_draw` (§6.4, §6.5 R7).
  - Turning it on while a deal offers the item → `422 weighed_item_in_deal` at `requires_weighing` (§6.5 R8).
  - Turning it on while an active option links the item → `409 CONFIG_IN_USE { used_by: { entity: 'modifier_group', ids } }` (R10).
- **"Create a stock item with this name"** (m7), with no new endpoint (§8). The calls, in order:
  1. §6.7 `POST /v1/admin/stock-items`.
  2. §6.9 `PUT …/branches/:branch_id` for each branch where the item is routed, with the route's station.
  3. The item PATCH with `stock_draws`.

  If a call fails part-way, the created stock item stays (it is listed on the Stock items page) and the form retries the remaining calls (§8).
- **Retries (N9):**
  - Generate the POST's `Idempotency-Key` **once** and reuse it on every retry of that POST. A retry after a lost response gets the replayed `201`.
  - Before retrying any remaining call, re-read §6.6 (the stock item, its branch rows and each branch `version`) and send only the calls still needed. Send each §6.9 PUT with the version just read, so a PUT that already succeeded is skipped instead of answering `409 CONFIG_STALE` (§8; test #124).
- **Test #124** (deferred here, N9): the POST response is lost → the retry with the same key gets the replayed `201` (one stock item). A PUT succeeds but its response is lost → the form re-reads §6.6, sees the row and its new version, and skips that PUT. Expected: no `409 CONFIG_STALE` and no `409 CONFIG_NAME_TAKEN` (component test with a mocked API) (§10.8b row 124).
- Item-side errors the form must show:
  - `409 CONFIG_IN_USE` with `used_by.entity` `modifier_group` or `deal`, on an archive (R4) or a unit change (R6, R10). Modifier groups are reported first (§6.5 rule precedence).
  - `422 archived` at `variant_group_id` when restoring a member of an archived group (R1a).
  - `422 archived` at `stock_draws.0.stock_item_id` when restoring an item whose stock item is archived (R9).
  - `409 CONFIG_NAME_TAKEN { entity: 'variant' }` (§6.4).
  - `503 SERVICE_UNAVAILABLE` after the §6.5 restart limit (N2).

## 3. Variant groups view (new; §8 "Views", §6.1–§6.3)

- Endpoints:
  - `POST /v1/admin/variant-groups` `{ name, category_id, description?, sort_order? }` → `201 { variant_group }` with `version` and `member_ids: []` (§6.1).
  - `PATCH …/:variant_group_id` with `expected_version` + any of `name`, `category_id`, `description`, `sort_order`, `archived` (§6.2).
  - The list comes from the §6.3 menu read (`variant_groups`).
- **`member_ids`** lists every member, archived members included (AD-8, §3.2 rule 4).
- Errors:
  - `409 CONFIG_NAME_TAKEN { entity: 'variant_group' }`.
  - Archiving a group with active members → `409 CONFIG_IN_USE { used_by: { entity: 'menu_item', ids } }` (R1).
  - A category change moves every member, archived ones too (§6.2 script). It can fail with `422 too_many_groups` at `category_id` (R3).
  - `422 category_id not_found / archived`.
  - `404 VARIANT_GROUP_NOT_FOUND` (§9).
- Name 1–60 characters, unique among active groups (§3.3).

## 4. Stock items view (new; §8 "Views", §6.6–§6.9)

- **List:** `GET /v1/admin/stock-items?status=` → `{ can_edit_tenant, stock_items: [{ …StockItemWire, branches: [{ branch_id, station_id, low_stock_threshold, version }], drawers: [{ item_id, name, variant_name, quantity_per_sale_unit }] }] }` (§6.6). StockItemWire is `stock_item_id`, `name`, `stock_unit`, `carries_over`, `archived`, `version` (§5.4).
- **"No row" at a branch:** the branch entry has `station_id: null` (AD-6, §6.9 encoding). Its `version` is the "no row" version (§5.4 `is_counted: false`).
- **Tenant form:**
  - `POST` `{ name, stock_unit, carries_over? }` (§6.7).
  - `PATCH` with `expected_version` + any of `name`, `stock_unit`, `carries_over`, `archived` (§6.8).
  - Name 1–60 characters; `stock_unit` ∈ `piece`, `g`, `ml` (§3.3).
- **Per-branch rows** "Counted here at station …, alert below …" (§8). Each row sends `PUT …/:stock_item_id/branches/:branch_id` `{ expected_version, station_id | null, low_stock_threshold? }` with that row's version (§6.9).
  - `station_id: null` removes the row; sending a threshold with it → `400`.
  - The threshold is `null` or 0 … 1 000 000, in `stock_unit` (§3.3). Enter and show it through `parseQuantity` / `formatQuantity` (01a S44).
  - The response is `{ branch: {…} | null }`.
- **Unit change notice:** a `stock_unit` change takes effect on each hub at its next day open, and counts in the old unit stop being valid (§6.8 Notes; S41, S44).
- Errors:
  - `422 { field: 'stock_unit', reason: 'unit_mismatch' }` when a unit change breaks a drawer (R1).
  - Archiving with active drawers → `409 CONFIG_IN_USE { used_by: { entity: 'menu_item', ids } }` (R2).
  - `409 CONFIG_NAME_TAKEN { entity: 'stock_item' }`.
  - Branch PUT: `422 station not_found / archived / wrong_branch`, `422 stock_item_id archived` on a set, `404 BRANCH_NOT_FOUND`.
  - `409 CONFIG_STALE { entity: 'stock_item_branch' }`. Two first-time PUTs from two tabs → one wins, the other is stale (M4).
  - `404 STOCK_ITEM_NOT_FOUND`.

## 5. Modifier groups view (new; §8 "Views", §6.10–§6.12a, V8, V19, F1)

- **List:** `GET /v1/admin/modifier-groups?status=` → `{ can_edit_tenant, modifier_groups: [ModifierGroupWire] }` (§6.10). Each group has:
  - `options` (active): `option_id`, `name`, `price_minor`, `max_quantity`, `is_default`, `linked_item_id`, `sort_order`.
  - `archived_options`.
  - `links`: `target_kind`, `target_id`, `mode`.
  - `branches: [{ branch_id, options: [{ option_id, is_offered, price_minor_override }], version }]`.
  - `version` (§5.4).
- **Group form:**
  - `POST` `{ name, min_choices, max_choices, sort_order?, options (1–50, no ids), links? (0–500) }` (§6.11).
  - `PATCH` with `expected_version` + any of the fields; `options` and `links` are sent whole (§6.12).
  - Limits: name 1–40; min 0 … 50; max 1 … 50; min ≤ max; option name 1–40, unique in the group; `max_quantity` 1 … 20; a plain option needs a price; a linked option's price is null or in range (§3.3).
- **Options table** (§8): show linked options, which use `linked_item_id`. The linked item must be `piece` and not weighed (`422 linked_item_not_piece`, §3.3).
- **"Applies to"** (§8; V8): attach or opt-out per target. `target_kind` ∈ `category`, `variant_group`, `item`; `mode` ∈ `attach`, `detach`. No `detach` on a category (`400`). One link per target (`400` at `links.N.target_id`). The most specific link wins (item > variant group > category).
- **Per-branch tab** "Offered here / Price here" per option (§8). It sends §6.12a `PUT …/:modifier_group_id/branches/:branch_id` `{ expected_version, options: [{ option_id, is_offered, price_minor_override? }] }`. This is the **whole** difference list at that branch (0–50), with the branch version (§6.12a).
  - `is_offered: false` with an override → `400`.
  - `options: []` resets every option to its default.
  - Errors: `409 CONFIG_STALE { entity: 'modifier_group_branch' }`; `422 modifier_group_id archived`; `422 options.N.option_id not_found`.
- **F1 warning:** warn when a required group (`min_choices ≥ 1`) has no option offered at a branch. The PUT is **allowed**: the builder keeps the group with `options: []`, and its items are not orderable there (§8; §6.12a merged-row rules; §4.6 rule 3). **spec: none** on the warning's wording.
- Errors:
  - `422 choices_unsatisfiable` (field `min_choices` or `options`, R2).
  - `422 defaults_exceed_max` (R3).
  - `409 CONFIG_NAME_TAKEN { entity: 'modifier_group' | 'modifier_option' }` (R4, §6.11).
  - `422 too_many_groups` at `links` (R5).
  - On a restore or an options save: `422 options.N.linked_item_id linked_item_not_piece / archived` (R6).
  - `422 options.N.option_id not_found` for another group's option.
  - `404 MODIFIER_GROUP_NOT_FOUND`.

## 6. Deals view (new; §8 "Views", §6.13–§6.16, V10, V11)

- **List:** `GET /v1/admin/deals` (with `status?`, AD-30 a) → `{ can_edit_tenant, deals: [DealWire] }` (§6.13). Each deal has:
  - `parts` (active, each with `choices`: `item_id`, `extra_price_minor`, `sort_order`).
  - `archived_parts`.
  - `availability_windows`.
  - `branches`.
  - `version`.
- **Branch entries carry `is_sold`** (AD-6): `{ branch_id, is_sold, price_minor_override, version }`, listed for every allowed branch. Without `is_sold`, a null override cannot tell "sold at base price" from "not sold".
- **Deal form:**
  - `POST` `{ name, category_id, tax_class_id | null, description?, sort_order?, price_minor, availability_windows?, parts: [{ quantity, sort_order?, choices: [{ item_id, extra_price_minor?, sort_order? }] }] }` (§6.14).
  - `PATCH` with `expected_version` + any of those fields, each list sent whole. Parts may carry `deal_part_id`. `archived` may be sent (§6.15).
  - A new deal is sold at no branch until §6.16.
- **Parts with choices** (§8):
  - 1–10 parts. Each part has 1–20 choices, one per item.
  - Every choice in a part shares a `sale_unit` (`422 choice_unit_mismatch` at `parts.N.choices`).
  - A single-choice part has extra 0 (`400`).
  - The part quantity is in the choices' `sale_unit` (§3.3; V10).
  - No weighed choice (`422 weighed_item_in_deal` at `parts.N.choices.M.item_id`, V18).
  - The same item may appear in two parts (§6.14 edge).
- **Per-branch "Sold here / Price here"** (§8): `PUT …/:deal_id/branches/:branch_id` `{ expected_version, is_sold, price_minor_override? }` (§6.16).
  - `is_sold: false` with an override → `400`.
  - Selling an archived deal → `422 archived`.
  - `409 CONFIG_STALE { entity: 'deal_branch' }`.
  - The response is `{ branch: null }` after a withdraw, and on a no-op with no row. Otherwise it is the stored entry with `is_sold` (AD-33 b, AD-6).
- **Restoring a deal** re-checks the stored category and tax class even when they are not sent (`422 category_id | tax_class_id archived`, AD-34), and the stored parts' choice items (AD-31 a).
- Other errors:
  - `409 CONFIG_NAME_TAKEN { entity: 'deal' }`.
  - `422 parts.N.deal_part_id not_found` for another deal's part (§6.15 edge).
  - `404 DEAL_NOT_FOUND`.

## 7. Omitted at a branch (m11, N9; test #115)

- The **Deals page** shows "Not sold at X: part N has no routed choice" for a deal sold at X whose part N has no choice routed at X (§8).
- The **Modifier groups page** shows "Not offered at X: its item is not sold there" for a linked option whose item has no route at X (§8).
- These warnings are computed in the owner app, with no new endpoint, from:
  - the §6.10 and §6.13 responses;
  - the `routes` of the choice and linked items, taken from the §6.3 menu pages that the page loads for its item pickers (§8).
- **Show them only after the last menu page has loaded** (`next_cursor: null`). Until then the page shows "Checking branches…" and no warning, so a partial load never hides an omission (§8, N9).
- **Test #115** (deferred here): both pages, with Gulberg as X. While the second menu page is still loading → "Checking branches…" and no warning; after the last page → the warning (§10.8b row 115).

## 8. Errors the UI must map (§9; 01a §9 A15)

| Code | What the UI reads | 01c additions |
|---|---|---|
| `409 CONFIG_STALE` | `entity`, `id` | `variant_group`, `stock_item`, `stock_item_branch`, `modifier_group`, `modifier_group_branch`, `deal`, `deal_branch` |
| `409 CONFIG_IN_USE` | `entity`, `id`, `used_by: { entity, ids }` | `entity` adds `variant_group`, `stock_item`, `menu_item`. `used_by.entity` adds `menu_item` (variant group members, stock item drawers), `modifier_group`, `deal`, `variant_group` (uses the category), `stock_item` (counted at the station) |
| `409 CONFIG_NAME_TAKEN` | `entity` | `variant_group`, `variant`, `stock_item`, `modifier_group`, `modifier_option`, `deal` |
| `422 CONFIG_REFERENCE_INVALID` | `field`, `reason` | the nine new reasons below |
| `404` | — | `VARIANT_GROUP_NOT_FOUND`, `STOCK_ITEM_NOT_FOUND`, `MODIFIER_GROUP_NOT_FOUND`, `DEAL_NOT_FOUND` |

Note: 01a and 01b codes such as `BRANCH_NOT_FOUND`, `PERMISSION_DENIED` and `SERVICE_UNAVAILABLE` keep their 01a / 01b handling (§6 shared failures).

**The nine new `CONFIG_REFERENCE_INVALID` reasons and their field paths:**

| Reason | Field path(s) | Source |
|---|---|---|
| `category_mismatch` | item write, item category ≠ its variant group's; field path: spec: none (read `field` from the response) | §3.3, §6.4 edge, §6.5 R1 |
| `unit_mismatch` | `stock_draws.0.stock_item_id` (item write); `stock_unit` (stock item PATCH) | §6.4 edge, §6.8 R1 |
| `linked_item_not_piece` | `options.N.linked_item_id` | §3.3, §6.11, §6.12 R6 |
| `choices_unsatisfiable` | `min_choices` \| `options` | §3.3, §6.12 R2 |
| `defaults_exceed_max` | `min_choices` \| `options` (§3.3 row) | §3.3, §6.12 R3 |
| `too_many_groups` | `links` (group write); `category_id` \| `variant_group_id` (item write: `variant_group_id` when the write sets or changes the group, else `category_id`, AD-21 a); `category_id` (§6.2 R3) | §3.3, §6.2 R3, §6.5 R3 |
| `choice_unit_mismatch` | `parts.N.choices` | §3.3, §6.14 edge, §6.15 R2 |
| `weighed_item_in_deal` | `parts.N.choices.M.item_id` (deal write); `requires_weighing` (item write) | §3.3, §6.5 R8, §6.15 R5 |
| `weighed_item_stock_draw` | `stock_draws` \| `requires_weighing` | §3.3, §6.4 edge, §6.5 R7 |

The existing reasons `not_found`, `archived` and `wrong_branch` gain the new 01c paths listed in sections 2–6.

## 9. i18n keys (§8 "i18n")

Add keys to both `apps/client/src/i18n/en.ts` and `ur.ts`:

- **Every label** of the views above (§8).
- `errors.CONFIG_REFERENCE_INVALID.<reason>` for each of the nine reasons: `category_mismatch`, `unit_mismatch`, `linked_item_not_piece`, `choices_unsatisfiable`, `defaults_exceed_max`, `too_many_groups`, `choice_unit_mismatch`, `weighed_item_in_deal`, `weighed_item_stock_draw` (§8; §9).
- **Fixed strings from §8:** "Changed elsewhere — reload", "Weighed when served", "Create a stock item with this name", "uses per sale", "Counted here at station …, alert below …", "Offered here / Price here", "Sold here / Price here", "Applies to", "Removed", "Restore", "Not sold at X: part N has no routed choice", "Not offered at X: its item is not sold there", "Checking branches…".
- **The F1 warning text:** spec: none on the wording.
- Urdu wording: spec: none. It is written by the UI module.

The `CONFIG_STALE`, `CONFIG_IN_USE` and `CONFIG_NAME_TAKEN` messages can say which entity is affected (`entity`, `used_by.entity`). spec: none — developer-listed: only the codes and entities above are fixed.

## 10. Wire facts from the status board (silent in the spec)

- **AD-6:** deal branch entries (§6.13 list and §6.16 response) carry `is_sold`. Stock item branch entries use a nullable `station_id` for "no row".
- **AD-8:** the variant group wire's `member_ids` lists every member, archived included (§3.2 rule 4). The §6.3 menu read uses the same rule.
- **AD-17:** the hub stock query's `items_meta.group_label` is the item's variant group name, else null. It is read by the hub stock page, not by the owner app. Schema-2 snapshot items have no `group_label`.
- **AD-30 a:** `GET /v1/admin/deals` takes `status?` (`active` default, `archived`), so archived deals can be listed for restore (developer Q-7).
- **AD-21 a:** the field for an item-write `too_many_groups` is `variant_group_id` when the write sets or changes the variant group, else `category_id`.
- **AD-33 b / AD-34 / AD-31 a:** the §6.16 response encoding, and the re-checks on a deal restore (sections 6 and 1).

## 11. Open follow-ups

1. **Owner coverage for units, low-stock threshold and `carries_over`** (logged follow-up; controller ledger, task 12 carry). These fields left the item form (§6.3 removes them; V4).
   - The UI module must cover `stock_unit` and `carries_over` on the stock item form (01a S41, S44; §3.5 rule 1).
   - It must cover `low_stock_threshold` on the per-branch stock item rows (01a S46; §3.5 rule 1).
   - The item form must show quantities in the stock item's unit (01a S44).
   - §8 names the "alert below …" row but no other rule. spec: none beyond §3.3 ranges and §6.8 Notes — developer-listed.
2. **Create-stock-item defaults:** §8 names the new stock item after the item ("with this name"). It does not say which `stock_unit` and `carries_over` the §6.7 POST sends, which `low_stock_threshold` (if any) the §6.9 PUTs send, or which `quantity_per_sale_unit` the item PATCH sends. Only the V4 unit rule constrains these. spec: none — to be decided in the UI module's spec.
3. **i18n key prefix:** the existing app keys reference reasons as `errors.reference.<reason>` (`apps/client/src/i18n/en.ts`), while §8 names `errors.CONFIG_REFERENCE_INVALID.<reason>`. The UI module must follow §8 or record a deviation. Do not silently diverge (CLAUDE.md).
4. **F1 warning wording**, and the Urdu text for every new key (spec: none).
5. **Tests #115 and #124** are deferred to the UI module (AD-35). They stay numbered in 01c §10, and the 01c coverage check in task 39 excludes them.
