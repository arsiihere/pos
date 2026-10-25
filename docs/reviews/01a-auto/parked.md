# Parked findings (fix in one pass later)
- [money] line-total: throw when the result is not Number.isSafeInteger; add a >2^53 test that a float version fails (review-01 nits 1–2).
- [pilot blocker] manage-stock for tenants seeded before task 4: add an idempotent cloud migration or seed step that grants it to existing Owner and Manager default roles; test it.
- formatQuantity: throw on negative or non-integer input (review-01 nit 3).
- canonicalJson: throw on function, symbol and bigint (review-01 nit 4).
