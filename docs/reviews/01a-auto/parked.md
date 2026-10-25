# Parked findings (fix in one pass later)
- [money] line-total: throw when the result is not Number.isSafeInteger; add a >2^53 test that a float version fails (review-01 nits 1–2).
- [pilot blocker] manage-stock for tenants seeded before task 4: add an idempotent cloud migration or seed step that grants it to existing Owner and Manager default roles; test it.
- formatQuantity: throw on negative or non-integer input (review-01 nit 3).
- canonicalJson: throw on function, symbol and bigint (review-01 nit 4).
- [spec gap, §4.3] snapshot station order: §4.3 names only tax classes and programs as "by name, then id"; stations have no sort_order and the builder sorts them by name, then station_id. Next spec version should state it; code unchanged until then (review-05 nit 2).
