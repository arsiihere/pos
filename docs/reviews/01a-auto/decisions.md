# Owner decisions for the auto loop (read before every batch; these override the plan's Files lists)

D1 (task 14): task 14 MAY edit apps/cloud/test/schema.int.test.ts. Change the module-00 test so it asserts that each of the 13 tables from 0001 exists (toContain each, not an exact list), and remove the "idempotency_keys does not exist" clause (00 M69 moved idempotency_keys to 01; 01a S7 creates it). Keep the test name and its [00 §5.2] tag. Mention this in the commit message and the build log.
