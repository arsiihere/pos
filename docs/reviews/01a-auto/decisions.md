# Owner decisions for the auto loop (read before every batch; these override the plan's Files lists)

D1 (task 14): task 14 MAY edit apps/cloud/test/schema.int.test.ts. Change the module-00 test so it asserts that each of the 13 tables from 0001 exists (toContain each, not an exact list), and remove the "idempotency_keys does not exist" clause (00 M69 moved idempotency_keys to 01; 01a S7 creates it). Keep the test name and its [00 §5.2] tag. Mention this in the commit message and the build log.

D2 (task 17): task 17 MAY edit eslint.config.js: add 'apps/cloud/test/helpers/**/*.ts' (and 'apps/hub/test/helpers/**/*.ts') to the files of the existing **/*.test.ts override block, so test helpers may import SystemContext like tests do (M56 still bans it in src). Keep the files already in the tree, then commit task 17.

D3 (general, from now on): test infrastructure outside a task's Files list may be changed WITHOUT stopping, if the task needs it: test helpers (apps/*/test/helpers/**), test-only config (vitest configs, the test-file override blocks in eslint.config.js), fixtures, and module-00 tests whose assertions the 01a spec makes outdated (e.g. an exact table or permission list). Record every such change in the commit message and the build log. Production code (any src/ file) outside the Files list, specs and plans STILL means STOP.

D4 (task 60): running ship-client.sh for its local checks is allowed (bash -n; no argument; dirty tree; a clean clone in /tmp without dist). ssh/scp stay denied: never ship to a real host. If a check would need ssh, record it as a runbook step instead of running it.
