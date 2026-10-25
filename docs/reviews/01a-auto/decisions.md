# Owner decisions for the auto loop (read before every batch; these override the plan's Files lists)

D1 (task 14): task 14 MAY edit apps/cloud/test/schema.int.test.ts. Change the module-00 test so it asserts that each of the 13 tables from 0001 exists (toContain each, not an exact list), and remove the "idempotency_keys does not exist" clause (00 M69 moved idempotency_keys to 01; 01a S7 creates it). Keep the test name and its [00 §5.2] tag. Mention this in the commit message and the build log.

D2 (task 17): task 17 MAY edit eslint.config.js: add 'apps/cloud/test/helpers/**/*.ts' (and 'apps/hub/test/helpers/**/*.ts') to the files of the existing **/*.test.ts override block, so test helpers may import SystemContext like tests do (M56 still bans it in src). Keep the files already in the tree, then commit task 17.

D3 (general, from now on): test infrastructure outside a task's Files list may be changed WITHOUT stopping, if the task needs it: test helpers (apps/*/test/helpers/**), test-only config (vitest configs, the test-file override blocks in eslint.config.js), fixtures, and module-00 tests whose assertions the 01a spec makes outdated (e.g. an exact table or permission list). Record every such change in the commit message and the build log. Production code (any src/ file) outside the Files list, specs and plans STILL means STOP.

D4 (task 60): running ship-client.sh for its local checks is allowed (bash -n; no argument; dirty tree; a clean clone in /tmp without dist). ssh/scp stay denied: never ship to a real host. If a check would need ssh, record it as a runbook step instead of running it.

D5 (review-14 Should-fix 2, before task 65): option (b). Do it now as task "64b" (its own commits), before task 65:
- Move the owner/admin RESPONSE Zod schemas (and request bodies the client sends) from apps/cloud/src/modules/restaurant/schemas.ts and owner-auth/schemas.ts into @pos/events (e.g. packages/events/src/admin/*.ts, browser-safe, no node:*). The cloud routes import them from @pos/events; apps/client/src/api/cloud-admin.ts derives its types with z.infer and drops the hand-written interfaces. No behaviour change; all existing tests stay green. Add one test per side that a real response parses with the shared schema.
- hub-admin.ts (task 66+) follows the same rule from the start (hub admin response schemas in @pos/events).
- This overrides the Files lists of the affected tasks. Record it in the build log. The spec §7.7 text already says "@pos/events schemas", so no spec change is needed.

D6 (review-14 Nit 2): ship-client.sh ships only when `systemctl is-active hub` prints inactive or failed; any other state (active, activating, deactivating, reloading) → refuse. Note "§7.8 (b) tightened by D6" in the commit message; the spec text is patched by Claude later.
