# 01a plan review — `docs/plans/01a-plan.md` against the repo and the spec

Date: 2026-10-25. Reviewer role: a senior engineer who must run the plan with nothing but the repo. Plan at commit `e4f42a9`. Code at branch `module-01`, with an uncommitted working tree (see #1).

**Spec reviewed against:** there is no `docs/specs/01a_*_Spec_v1.0.md`. The only 01a spec is `docs/specs/01_Restaurant_Setup_Spec_v0.4.md` (DRAFT, not reviewed). This review uses v0.4, which is also what the plan cites.

Method: read the plan, spec v0.4, the 00 spec rows it patches, and the code each task touches (hub boot, writer, state holder, registries, guards, test helpers; cloud server, repositories, tenant scope, CLIs, test helpers, inventory and cross-tenant tests; eslint, vitest, tsconfig, package manifests). Checked dependency versions on npm. Checked the coverage table by script: tests 1–112 each appear exactly once (no finding).

Severity: **Blocker**: the task can't be done as written, or `pnpm test` goes red for a reason the task doesn't explain, so the implementer has to stop. **Major**: the implementer has to guess, or the result breaks the spec or a rule. **Minor**: friction, an unclear step, or a small spec gap.

Summary: 6 blockers, 14 majors, 25 minors.

---

## Blockers

### 1. The plan's spec is a draft that hasn't been reviewed, and on a clean checkout the file doesn't exist
- The requested spec `01a_*_Spec_v1.0.md` does not exist. The plan targets `01_Restaurant_Setup_Spec_v0.4.md`, whose header says "DRAFT … Not reviewed. Pipeline step 4 (hostile review in a fresh session) comes next." CLAUDE.md puts that review (step 4) before the plan (step 5) and the build (step 6).
- `git ls-tree HEAD docs/specs/` lists `01_Restaurant_Setup_Spec_v0.3.md`, not v0.4. The v0.3 → v0.4 rename and the README row change are uncommitted. The plan's commit (`e4f42a9`, "plan for spec v0.4") points at a file that HEAD doesn't contain. Someone cloning the branch can't open the source of truth.
- **Fix:** commit v0.4 and the README change. Run the hostile review. Bump to the reviewed version (v1.0 if that's the intent). Then re-baseline the plan's "Spec:" line, the §/S citations and the Global Constraints values against that version before task 3.

### 2. Task 10: `bumpConfigVersion` can't satisfy both D54 (the repositories) and S8 ("every branch of the tenant")
- `TenantScopedRepository.query` throws `TypeError('scoped SQL must reference $1 and $2')` unless the SQL contains `$2`, and it always binds `$2 = request.tenant.branchIds` (`apps/cloud/src/db/tenant-scoped-repository.ts:25-31`). Task 10's literal SQL (`… WHERE tenant_id = $1 AND branch_id = $3 RETURNING`) has no `$2`, so it throws.
- Tenant scope: S8 bumps **every** branch of the tenant. A scoped query adds `branch_id = ANY($2)` (the JWT's `allowed_branch_ids`), so an owner whose JWT lists only some branches would bump only those, and the other hubs would never fetch a menu change. The only other option, running `branches` through `TenantLevelRepository`, is outside the plan's list of tenant-level tables (Global Constraints, "Cloud SQL").
- **Fix:** decide in the spec which repository `bumpConfigVersion` uses for each scope, and give the exact SQL for both. For example: branch scope `… WHERE tenant_id = $1 AND branch_id = ANY($2) AND branch_id = $3`; tenant scope through `TenantLevelRepository` on `branches`, recorded as an allowed exception.

### 3. Task 21: the CLI can't call `bumpConfigVersion` or `writeConfigAudit`
- Both take `(client: pg.PoolClient, tenant: TenantContext, …)` (Interfaces block). `SystemContext` keeps its `client` private (`apps/cloud/src/cli/system-context.ts:4-7`) and exposes only `query` / `tx`. The CLI has no `TenantContext`, and `assertTenantContext` requires a frozen object. The M56 lint rule (`eslint.config.js`, `systemContextImports`) stops `src/lib/*` from importing `SystemContext`, so the helpers can't take one either.
- §6.7 requires `set-branch-settings` to write the audit row and bump in one transaction (test #105).
- **Fix:** give the helpers a narrow `Queryable` parameter (`{ query(sql, params) }`) instead of `pg.PoolClient`, and define how the CLI builds the tenant scope (it reads `tenant_id` from the locked branch row). Or add a `SystemContext` accessor; that edits a 00 file, so the plan has to list it.

### 4. Task 22 breaks 00's boot-budget test (#100)
- `projections.catchUp` replays every event from seq 0 for any registered projection that has no checkpoint (`apps/hub/src/projections/registry.ts:66-70`), with a `JSON.parse` and a Zod `parseEvent` per event. The 1M-event fixture checkpoints only `access_reconcile` (`apps/hub/test/helpers/big-fixture.ts:68`, `test/boot/boot-budget.int.test.ts:39`). Once task 22 registers `branch_config` and `item_availability` in `createDeps`, `boot()` replays 1M events twice. That can't fit `expect(elapsed).toBeLessThan(5_000)`, and task 25/27's full-table stock fold adds to it.
- Task 22's `pnpm test` goes red for a reason the task doesn't mention, and the fix (fixture checkpoints for the new projections, or a change to the 00 test) touches files the task doesn't list.
- **Fix:** add `apps/hub/test/helpers/big-fixture.ts` to task 22 (seed checkpoints = N for the two new projections) and note it in the 00 build log. Also decide whether the new projections can skip catch-up on an empty table. In production this replay also runs once on the first boot after migration 0004.

### 5. Task 25 uses `EngineState` two tasks before the hub depends on `@pos/engine`
- Task 25 types `QueryCtx.state: Readonly<EngineState>` (Interfaces block, "QueryCtx gains (task 25)"). `apps/hub/package.json` gains `"@pos/engine": "workspace:*"` only in task 27, so the import doesn't resolve and `pnpm typecheck` fails. `HubDeps.state` is also still `StateHolder<unknown>` until task 27, so the types don't line up either.
- **Fix:** move the `@pos/engine` dependency and the `HubDeps.state` / `CommandCtx.state` typing into task 25, or move the `QueryCtx` change into task 27.

### 6. Cloud test hooks and builders can't be injected: `test-cloud.ts` is in no task's Files list
- `createTestCloud(o?: { captureLogs?: boolean })` builds its own `CloudDeps` (`apps/cloud/test/helpers/test-cloud.ts:24-49`). Task 12 (`testHooks.beforeBump`, #83), task 14 (`snapshotBuilders`, #96) and task 20 (`afterTargetLock` / `afterReferenceLock`, #86/#87) all need those deps passed through. None of them lists `test-cloud.ts`, and `.cursor/rules/pos.mdc` says "Touch only the files listed … If the task cannot be done without touching another file, stop and ask."
- **Fix:** add `apps/cloud/test/helpers/test-cloud.ts` (new options `testHooks`, `snapshotBuilders`) to task 12, and to task 14 for `snapshotBuilders`.

---

## Majors

### 7. Task 25 loads the branch config before projection catch-up
- The plan loads `loadBranchConfig(db, branchId)` "at the step-3 position" (Open decision 3). Projection catch-up is step 4 (`apps/hub/src/lib/boot.ts:153`). The `branch_config` projection is rebuildable (§5.1). Whenever its checkpoint is missing or behind (first boot after 0004 on a hub that has history, a projection rebuild, the #47 rebuild path), step 3 reads a stale or missing row. The hub then boots as `NONE` and polls with `config_version=0`, or keeps an old config.
- **Fix:** load the config after `deps.projections.catchUp` (between step 4 and step 5). The stock fold can stay at step 3, because it reads events, not a projection.

### 8. Task 27's Files list is incomplete for the type change
- `WriterTx.state` is `Readonly<unknown>` (`apps/hub/src/engine-host/writer.ts:40`), and `route.ts:102` assigns `state: tx.state` into `CommandCtx`. Once `CommandCtx.state: Readonly<EngineState>`, that line no longer typechecks unless `writer.ts` (or `WriterTx`) becomes generic or `route.ts` casts. Neither file is listed.
- **Fix:** add `apps/hub/src/engine-host/writer.ts` and/or `apps/hub/src/commands/route.ts` to task 27, and say which approach to take (a cast in `route.ts` is the smallest change).

### 9. Tests #1 and #96 can't count "exactly 1" and "0" statements as written
- The `branch-key` tenant guard runs `branchByApiKeyHash(deps.pool, …)` before the handler (`apps/cloud/src/plugins/tenant-scope.ts:48-53`). `pgCounter` wraps `pool.query` (task 11), so the guard's lookup counts. A `304` is therefore ≥ 2 statements, and the `409 SNAPSHOT_SCHEMA_UNSUPPORTED` path is ≥ 1, not 0.
- **Fix:** define the counting window in the plan: reset the counter inside the handler (for example, a test hook at handler entry), or state "1 statement after authentication". The hub tests #72 and #92 have the same issue; see #31.

### 10. The `/admin/stock` tests need IndexedDB, which jsdom doesn't provide
- `createHubAdmin(o: { fetch? })` reads the device token from IndexedDB `pos-device` / `device` (Interfaces block; matches `apps/hub/src/auth/pair-page.ts:25-36`). jsdom has no `indexedDB`, and S35 g forbids adding `fake-indexeddb`. #77, the #102 page part and Review Focus 4 render `StockApp`, which goes through that client.
- **Fix:** add an injectable `readDeviceToken?: () => Promise<string | null>` (and `storage?: Storage`) to `createHubAdmin`, as `createCloudAdmin` already does for storage.

### 11. Task 34's ESLint changes have two traps
- (a) The clock ban and the new `dangerouslySetInnerHTML` ban are both `no-restricted-syntax`. The plan says "the F §6.7 clock rule is off for `apps/client/src/**`", and the Global Constraints say "add `apps/client/src/**` to the lint exception list". That list sets `'no-restricted-syntax': 'off'` (`eslint.config.js:105-118`), which would also turn off the XSS ban, so test S35 e would fail or pass depending on block order.
- (b) In flat config, a later block's `no-restricted-imports` **replaces** the earlier options. A client block with only the S35 f patterns drops the root patterns (`db/client`, `system-context`, `credential-lookup`, `qrcode`).
- **Fix:** give the exact config block: for `apps/client/src/**`, `'no-restricted-syntax': ['error', { selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]', … }]` (no `forbiddenCalls`), and `no-restricted-imports` with the root patterns plus the S35 f patterns. Keep `apps/client/src/**` out of the existing `'off'` list.

### 12. The implementer rules file points at module 00
- The plan says "follow `.cursor/rules/pos.mdc`". That file says "The current plan for module 00 is `docs/plans/00-plan.md`; it implements `…_Spec_v1.1.md`. Read the plan's 'Global Constraints' before every task" (line 14). It also uses the marker "NOT for Cursor" where this plan uses "Claude only". Someone with zero context reads the wrong constraints.
- Because pos.mdc forbids touching unlisted files, every Files gap in this review (#6, #8, #4, task 3's "if a hub test lists 19 permissions, update it") becomes a hard stop.
- **Fix:** update pos.mdc to name `docs/plans/01a-plan.md` and the 01a spec, and the "Claude only" marker (`.cursor/` is outside `docs/`, so it's a Claude-only step before task 3).

### 13. `pollOnce` has no defined result for "skipped", and test hubs are never confirmed
- §3.4 step 1: skip if not provisioned **or not confirmed**. `createTestHub`'s config has no `provisioned.confirmed_at` (`test/helpers/test-hub.ts:135-140`), and `isConfirmed` checks exactly that (`src/config/schema.ts:71`). So every poller test as described skips. `PollOutcome` has no `skipped` member, so what `pollOnce()` returns (and what `pull-now` answers) before confirmation isn't defined.
- **Fix:** add the return value for a skipped poll (for example, `offline` with no HTTP call, or a new outcome; spec §6.21 lists the allowed outcomes) and how `pull-now` maps it. Tell tasks 23–25 to create the hub with `config: { provisioned: { …, confirmed_at: T } }`.

### 14. No task imports the UI kit (S35 d)
- `packages/ui-kit` has no `package.json`, so it isn't a workspace package and can't be imported by name. No task says how the client imports `tokens.css`, `components/bundle.css` and `fonts/` (a relative path from `src/app/mount.tsx`?), or checks that the fonts end up in `dist/*/assets`. Task 36 says "UI kit classes" without the import. Test #15 checks only that cloud `/ui/*` returns 404.
- **Fix:** put the import path into task 34 (for example, `import '../../../../packages/ui-kit/tokens.css'` in `mount.tsx`), and add a build check (an `assets/*.woff2` file exists in both dist folders).

### 15. Several tasks are too big for one TDD commit
- Task 11: fixture helper + `pgCounter` + the four-file module skeleton + server wiring + the cross-tenant `ROUTE_CASES` refactor + 6 tests.
- Task 23: holder + HTTP client + poller core + stub helper + server wiring + test-hub change + 7 tests.
- Task 25: boot integration + `BODY_MISSING` + timer + `stop()` semantics + `QueryCtx` change + 6 tests.
- Task 34: new package, Vite config, two entries, router, i18n, tsconfig, ESLint, lint tests, `.gitignore`.
- Task 36: money parser + API client with refresh-once + login view + branch picker + app shell + form hook + 4 tests.
- Task 39: API client + PIN login + stock table + banners + 4 tests.
- **Fix:** split each in two. Suggested cuts: 11 → fixtures/`pgCounter`/`ROUTE_CASES` refactor | floors; 23 → holder + client | `pollOnce`; 25 → boot + `BODY_MISSING` | timer + `QueryCtx`; 36 → money + `cloud-admin` | views; 39 → `hub-admin` + PIN login | stock table + banners.

### 16. Task 43's runbook can't be followed from the repo
- It gives no commands to start the cloud or hub. There are no `start` scripts: `apps/cloud/package.json` has only `typecheck`, `seed-tenant`, `issue-registration-code`. The setup that does exist is in `docs/manual-test-00.md` §1–2 (`node --import tsx src/main.ts`, a `cloud` wrapper, `pos_manual` database, cloud on port **4000**), and the plan doesn't mention it. The plan says `http://localhost:3001/owner/`.
- It doesn't warn that `pos_test` is truncated by the cloud tests. It needs the client built first, which isn't stated. It writes to a new `docs/runbooks/` folder, while 00's runbook lives at `docs/manual-test-00.md`.
- **Fix:** base task 43 on `docs/manual-test-00.md` (same database, ports and wrappers), add `pnpm --filter @pos/client build`, and have task 44 write `docs/manual-test-01a.md` to match.

### 17. The plan departs from the spec without changing the spec first
- Open decisions 2 (`onBranchConfigApplied` gets a third `tx` argument; §4.2 is an exposed contract for 03a/03b), 3 (inline boot code instead of `registerBootStep`; §4.1, S15, and 03a is told to "replace 01a's boot step 3"), and 4 (`admin-bootstrap` instead of §7.1's `admin-page`) all change spec text. Only decision 1 says Claude records it at the next bump. CLAUDE.md: "If code and spec disagree, STOP … never silently diverge"; "Any behaviour change goes spec-first."
- **Fix:** fold decisions 1–4 into the reviewed spec version (#1) before tasks 4, 23, 25 and 35, so the plan's interfaces and the spec match.

### 18. Deploying the built client is not covered by any task (S35 c)
- S35 c: "Both deploys run `pnpm --filter client build` first; the hub release ships the built files." `apps/hub/deploy/hub.service` runs the repo through `tsx`, and `docs/manual-test-00.md` says "There is no build step." No task updates either. Task 35's `dir: <apps/client/dist/admin-stock>` is a placeholder: how the hub and cloud resolve that path (relative to `import.meta.url`? configurable?) is left open.
- **Fix:** give the exact path expression in task 35 (for example, `fileURLToPath(new URL('../../../client/dist/admin-stock/', import.meta.url))`), and add a step that documents the build in the deploy notes.

### 19. Task 3's "unit, no DB" test needs Postgres, and so does every task
- `apps/cloud/test/default-roles.test.ts` runs in the `@pos/cloud` Vitest project, whose `globalSetup` waits about 10 s for Postgres and then throws (`apps/cloud/vitest.config.ts`, `test/helpers/global-setup.ts`). So task 3's command fails without Docker. More broadly, every task ends with `pnpm test`, which runs the cloud integration suite. The "needs Docker Postgres" marker on only some tasks is misleading.
- **Fix:** say once in Markers that Postgres must be up for every `pnpm test`. Put the default-roles test where it doesn't need the database, or mark task 3.

### 20. Task 4: adding `@types/node` alone won't typecheck `hash.ts`
- `tsconfig.base.json` has `"types": []`, so the ambient `node:*` modules load only through `/// <reference types="node" />`. That's what every hub and cloud file using `node:` does (for example, `apps/hub/src/lib/hash.ts:1`). The plan doesn't say to add it.
- **Fix:** add "`hash.ts` starts with `/// <reference types="node" />` (repo pattern)" to task 4.

---

## Minors

### 21. Task 34's client tsconfig is underspecified
It doesn't say whether it extends the base (`module`/`moduleResolution: NodeNext`, which needs `.js` extensions on relative imports) or uses `bundler`. It doesn't give `include`/`exclude`. `vite.config.ts` (`node:path`, `node:url`) and `test/lint.test.ts` (`eslint`, `node:*`) need `@types/node`, which isn't in the S35 g list and isn't resolvable from `apps/client` under pnpm. **Fix:** spell out the tsconfig (`include: ["src"]`, exclude `**/*.test.tsx`, and pick one module resolution).

### 22. `lint.test.ts` runs in jsdom
The client project sets `environment: 'jsdom'` for everything, including ESLint's `lintText`. **Fix:** add `// @vitest-environment node` at the top of `apps/client/test/lint.test.ts`.

### 23. The React test environment needs a flag
Rendering with `react-dom/client` and `act` from `react` needs `globalThis.IS_REACT_ACT_ENVIRONMENT = true`, or React warns on every update. No `setupFiles` is planned. **Fix:** add a `setupFiles` entry in task 34.

### 24. jsdom 30.1.3 needs Node ^22.22.2
`npm view jsdom@30.1.3 engines` → `^22.22.2 || ^24.15.0 || >=26`. Root `engines` is `>=22 <23`, and S35 g only checked Vite (≥ 22.12). This works on the dev box (22.22.3) but fails on an older 22.x. **Fix:** note the floor in the spec or raise `engines`.

### 25. CSP `default-src 'self'` blocks inline style attributes and `data:` URIs
React `style={…}` and Vite's inlined small assets (`build.assetsInlineLimit`, default 4 KB) are blocked under that CSP. **Fix:** in task 34/36, ban `style=` props or set `assetsInlineLimit: 0`, and extend #15 to load the page's assets.

### 26. #84's cross-tenant clause was dropped
Spec #84 says "cross-tenant test covers `config_audit` (D54)", and §12.1 repeats it. Task 8's #84 checks only the trigger and indexes. **Fix:** add the clause to task 8 or task 11.

### 27. §7.5 performance targets aren't measured
The 304 path ≤ 20 ms p95, the snapshot build ≤ 200 ms for 300 items, and the hub apply ≤ 100 ms have no task. Only the optional hardware check in task 43 measures anything. **Fix:** add timing lines to #5 and #42, or to the hub smoke script.

### 28. §7.3 logging is untested
The outcome log levels are untested, and so is "never logs the snapshot body or the directory (PIN hashes)", even though the repo has a log-redaction test pattern (`apps/hub/test/log-redaction.int.test.ts`). **Fix:** add a §7.3 test to task 23 using `h.logs()`.

### 29. `pull-now` mappings aren't in the spec
§6.20 lists only `applied | unchanged` → 200, and offline, timeout or cloud 401 → 503. The plan adds `epoch_changed` → `applied`, and `rejected` / `upgrade_required` → 503. **Fix:** record these in the spec.

### 30. It's not said which layer maps a cloud 5xx to `offline`
`ConfigFetch` has `{ kind: 'error', status }`, but §3.4 step 3 maps 5xx to `offline`, and the plan doesn't say whether `httpConfigClient` or `pollOnce` does it. **Fix:** say where.

### 31. The hub statement counts are easy to get wrong
Queries run on `deps.readDb` (`queries/registry.ts:107`), while the guards run on `deps.db`. `statementCounter` only sees statements prepared after it is installed (`test/helpers/statement-counter.ts:6`), so a module-level cached `prepare` is invisible. **Fix:** in tasks 29, 30 and 33, say to install the counter on `deps.readDb` (for queries) and that handlers prepare per call.

### 32. #48's starting state is hard to build
`config_snapshots` has a DELETE trigger, so the test can't simply delete the body. **Fix:** describe the setup (for example, append `BranchConfigApplied` through `writer.run` without the snapshot insert, or copy a DB without the row).

### 33. `SetPrecookedStock` `set_at` in the result can differ from the stored value
The handler uses `ctx.clock.branchNow()`, but `appendEvents` reads the clock again for `recorded_at` (`engine-host/append-events.ts:12`). On the real branch clock they can differ by milliseconds, so the result disagrees with the stock query (#72). **Fix:** take `set_at` from the appended events (needs `route.ts` support), or accept and document the difference.

### 34. The boot stock fold scans the whole table
`WHERE branch_id = ? AND event_type = 'StockSet'` has no index. `events_stream (stream_type, stream_id, seq)` exists. **Fix:** query `stream_type = 'stock' AND event_type = 'StockSet'` so the index is used (this matters for #100, see #4).

### 35. Setting `process.env.TZ` in `beforeAll` leaks
Vitest's default `forks` pool reuses processes, so the time zone carries into later files. **Fix:** restore it in `afterAll`.

### 36. #104's "Not counted today" part has no home
The badge is a page concern. The hub unit test can only check `businessDayStartedAt`, and the client can't import hub code (S35 f). **Fix:** put the badge predicate in the client and test that part in task 39, or move it into a shared package.

### 37. #76 needs a form component that task 36 doesn't build
"Form component: submit fails, retry sends the same key; reopen → new key." No real form exists until task 37. **Fix:** name the component (for example, the floor create form) and move #76 to task 37, or allow a test-only component.

### 38. The Interfaces block and task 12 disagree on when `testHooks` is added
The Interfaces block says "CloudDeps gains (task 14): … testHooks"; task 12 adds it. **Fix:** make them agree.

### 39. The idempotency-key error path must be thrown by hand
If `Idempotency-Key` is checked through a Fastify `schema.headers`, the 00 error handler reports `path: 'idempotency-key'`, not `'headers.idempotency-key'` (`plugins/error-handler.ts`, `instancePath`). Body validation also runs before the tenant-scope `preHandler`, so a bad body returns 400 before 401/404. **Fix:** tell task 9 to throw `DomainError` in `withIdempotency`, and tell task 11 that every `ROUTE_CASES` payload must be valid.

### 40. Task 1's line number is off by one
S25 and task 1 say "line 7 (version)". The 00 spec's Version row is line 8; lines 472 and 481 are correct.

### 41. Task 42 may change answers that earlier tests pinned
After task 42, a poll whose epoch differs carries the directory. If task 14's #99 asserts `directory: null`, task 42 breaks it. **Fix:** tell task 14 to assert only the config part for #99.

### 42. `QueryCtx.config` and `CommandCtx.config` have the same name and different types
`QueryCtx.config` is `BranchConfig | null`; `CommandCtx.config` is `HubConfig` (`commands/registry.ts:27`). That's easy to misuse in 02. **Fix:** note it in the spec, or name the query field `branchConfig`.

### 43. Task 30's stock query flag differs from the spec
The plan says `session: 'none'`; spec §6.19 says "session required". For admin queries the flag isn't checked (`queries/registry.ts:97`), and 00's admin queries use `'none'`, so the behaviour is the same. Say so to avoid a "code and spec disagree" stop.

### 44. #55 needs a valid device token
On the `admin` route group the device guard runs before the admin guard (`auth/guards.ts:67-76`). Without a device token the answer is `401 DEVICE_TOKEN_INVALID`, not `ADMIN_SESSION_REQUIRED`. **Fix:** tell task 31 to send a paired device's token with no admin session.

### 45. The plan's money rule goes beyond the spec
Review Focus 2 accepts any comma grouping (lakh `"1,20,000"`) and surrounding spaces. §8.1 shows only `"1,200"`. If it stays, add it to §8.1; also decide whether `"1,2,3"` is accepted.

---

## Checked and fine (no action)
- Every name in "Starting point" exists (`writer.run`, `createStateHolder`, `createProjectionRegistry`, registries, `registerStationValidator`/`stationExists`, `registerEventAudience`, `registerCatchUp`, `applyStaffDirectory`, `swapDirectory`, test helpers; cloud repositories, `TENANT_SCOPE_ALLOWLIST`, `loadDirectory(client, tenantId, branchId)`, `SystemContext`, `seedTenant`, `issueRegistrationCode`, `createTestCloud`, `truncateAll`).
- `lib/boot.ts:278–279` and `setup/issue-admin-bootstrap.ts:44–45` are the identity-reducer lines, as stated.
- `createTestHub({ testHooks: { beforeCommit } })` exists, so #46/#65 can force a COMMIT failure.
- Fixture count is 14 today (→ 18 in task 6). Migration numbers are free (hub `0004`, cloud `0002`). `stream_type 'stock'` exists. `SERVICE_UNAVAILABLE` and `Retry-After` on 503 work in both error handlers.
- `pnpm vitest run --project @pos/<name>` resolves project names from `package.json`.
- Dependency pins exist on npm (`react`/`react-dom` 19.3.1, `@types/react`/`@types/react-dom` 19.3.0, `jsdom` 30.1.3, `vite` 8.3.5), and Vitest 4.1.12 accepts Vite 8.
- The admin guard already enforces `access-hub-admin` on every `admin`-group route, so §6.20/§6.21 need no extra check.
- Coverage table: 112 numbers, each once.
