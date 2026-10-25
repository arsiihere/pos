# Parked findings (fix in one pass later)

Status after the 2026-10-26 wrap-up: items marked **done** are closed; the two **open** spec gaps need an owner decision (behaviour change, spec-first) and are tracked in `whole-module-check.md`.

- **done** `32bd361`: [money] line-total: throw when the result is not Number.isSafeInteger; add a >2^53 test that a float version fails (review-01 nits 1–2).
- **done** `2148812` (migration `0003_manage_stock_backfill.sql`, spec S18 v1.0.1): [pilot blocker] manage-stock for tenants seeded before task 4: add an idempotent cloud migration or seed step that grants it to existing Owner and Manager default roles; test it.
- **done** `7b4e3fe`: formatQuantity: throw on negative or non-integer input (review-01 nit 3).
- **done** `2c6abbe`: canonicalJson: throw on function, symbol and bigint (review-01 nit 4).
- **done** spec v1.0.1 §4.3: [spec gap, §4.3] snapshot station order: §4.3 names only tax classes and programs as "by name, then id"; stations have no sort_order and the builder sorts them by name, then station_id. Next spec version should state it; code unchanged until then (review-05 nit 2).
- **done** `4448e72` (also StationsView `CommitField`): FloorsView: a rejected rename keeps the refused text; reset on failure (review-14 nit 3).
- **done** `6d0ca38`: cloud-admin: concurrent logouts call onLoggedOut several times; call once per failed refresh (review-14 nit 4).
- **done** spec v1.0.1 §7.8 step 5 (b): Spec §7.8 (b): patch text to match D6.
- **done** spec v1.0.1 §6.21: Spec §6.21: add tenant_id, branch_id to the config-status response (D7).
- **open** (owner decision): [spec gap, §6.19/§8.2] add `category_name` to `items_meta`; the /admin/stock category filter shows raw category_id until then (review-16 S2).
- **open** (owner decision): [spec gap, §6.19/§6.18b/§8.2] return `day_min_gap_hours` so the `opened_recently` text can name it; the page says "only a short time ago" until then (review-16 S2).
