APPROVE

# 01a auto review — batch 13 (tasks 57, 58, 59)

Reviewer: independent, read-only. Commits reviewed: `10a1619` (task 57), `10f91f1` (task 58), `0168625` (task 59). Spec: `01_Restaurant_Setup_Spec_v1.0.md` S21, S35, S39 a/b, S47, §7.1, §10 #15, #75, #78, #79, #113, #125.

## Verification run by the reviewer

- `pnpm test` (runs `pnpm --filter @pos/client build` first): **134 files, 502 tests, all passed** (121 s). This matches the batch report.
- `pnpm lint`: **clean** (no output, exit 0) at HEAD.
- `pnpm typecheck`: 6/6 tasks successful.
- Working tree: only `apps/hub/deploy/ship-client.sh` is untracked. It belongs to task 60 (the STOP) and was not reviewed here.

## Spec conformance per task

**Task 57.** `apps/client/package.json:9-21` pins exactly the S35 g closed list (react/react-dom 19.3.1; vite 8.3.5, jsdom 30.1.3, @types/react and @types/react-dom 19.3.0) plus the three `workspace:*` packages. The lockfile adds only the transitive dependencies of those packages (jsdom's tree, scheduler, csstype). `vite.config.ts:5-22` sets one build per mode, `root ./<mode>/`, the correct `base`, `outDir dist/<mode>/`, `emptyOutDir`, `manifest: true` and `assetsInlineLimit: 0` (S35 d, S39 a), has no plugin, and throws on an unknown mode. `ulid.ts:6-28` follows S35 j: 10 time characters from `Date.now()`, 80 bits from `crypto.getRandomValues`, Crockford base32, no `randomUUID`. `ui-kit.ts:2-3` holds the only two CSS imports (S35 d). `router.ts` is a hash switch with no dependency (S35 b). The `tsconfig.json` matches R21, and `dist/` is already ignored by the root `.gitignore` (`dist/`). Root `package.json` has the `test` script and `engines.node >=22.22.2 <23` from the plan.

**Task 58.** The block at `eslint.config.js:168-199` is the plan's block, character for character, and it is last (R11). It repeats the root patterns, as flat config requires.

**Task 59.** Both `client-dist.ts` copies implement §7.1. They read the file list and bodies once (`load`, lines 53-71). `index.html` and other non-`assets/` files get `no-cache`, and `assets/*` get `immutable`. The extension map is fixed, so `.vite/manifest.json` is skipped at load. Requests are looked up in a Map only, so no path ever reaches the filesystem and traversal cannot happen. Symlinks fail `isFile()` and are skipped. A missing directory is logged at `error` and the routes answer 404. The S21 CSP is on every served file. Misses throw `DomainError('ROUTE_NOT_FOUND')`, so each app's error handler writes the F §6 envelope. The hub uses group `admin-page` = host, provisioned, guest (`guards.ts:23,37`, verified by `guards.int.test.ts:17`). The cloud uses `tenantScope: 'none'`, and the allowlist gains `GET /owner/` and `GET /owner/*` (`tenant-scope.ts:9-15`). The HEAD mirror goes through the existing `GET` allowlist check (`tenant-scope.ts:111`). Tenant isolation is not weakened: the owner pages carry no data (S21), and no `/v1/admin/*` route changed. The error log line contains only `dir` and the fs error, with no secrets.

## Tests

| Test | Where | Verdict |
|---|---|---|
| S35 b hashchange | `router.test.tsx:26` | Real: renders and changes the hash twice. Fails without `router.ts`. |
| #125 | `ulid.test.ts:19` | Covers every clause: ULID_RE, time decoded back equals the mocked `Date.now()`, `getRandomValues` spied, 1 000 distinct values, `randomUUID: undefined`. |
| #113 | `build-output.test.ts:31` | index exists, every ref is inside the entry, no inline script, no data: URL, manifest clause. The manifest clause is weak (Nit 2). |
| S35 d woff2 | `build-output.test.ts:65` | Real. |
| #79 | `lint.test.ts:17` | Every refused import gives exactly one error. The `style` prop, the allowed set, and a whole-`apps/client` lint run are all checked. |
| #75 page part | `lint.test.ts:52` | Real. |
| S35 j, S47, F §6.7 | `lint.test.ts:57,66,72` | Real. Date.now is checked both ways (client passes, hub fails). |
| #78 | `hub/test/client-dist.int.test.ts:27` | Runs against both helpers. Covers index/asset headers, the manifest, plain and encoded `../`, unlisted names, the other entry's file, the missing dir with exactly one level-50 log line, and CSP on every file. |
| §7.1 hub wiring (extra) | `client-dist.int.test.ts:95` | Real build, guards list, guest network 403. |
| #15 | `cloud/test/owner-pages.int.test.ts:13` | No JWT, exact CSP on index/js/css, no inline script, `/ui/tokens.css` 404, allowlist and scopes. The route-inventory test was updated (`route-inventory.int.test.ts:6`). |

Each numbered test appears once. Each would fail without its code: either the module is missing, the dist is missing, the lint block is missing, or the route returns 404.

Files: every changed file is in its task's Files list. No dependency outside S35 g.

## Blocker

None.

## Should-fix

None.

## Nit

1. **Lint red at `10a1619`** (`apps/client/src/app/ulid.ts:6`). `Date.now()` trips the root F §6.7 rule until task 58 adds the client block, so a bisect over this range hits a commit where lint fails. Fix (in future plans): order the lint-rule task before the first client source that needs it, or add `pnpm lint` to task 57's command list and fold the client block into the scaffold task.
2. **#113 manifest clauses are vacuous under Vite 8** (`apps/client/test/build-output.test.ts:56-62`). The manifest lists only `index.html` and the font assets. TSX modules and the kit CSS are bundled into chunks and never appear as keys or `src`. So "no module under the other entry's `src/features/`" and "no `.css` source outside `packages/ui-kit`" pass with nothing to check. Scenario: a later `owner/main.tsx` imports `../admin/stock/StockTable`, and #113 stays green. Lint #79 still covers the CSS clause; nothing covers the cross-entry one. Fix (spec-first, §10 #113): decide on a check that sees bundled modules. For example, build with `build.sourcemap: 'hidden'` and check each map's `sources` list (the maps are not in the §7.1 extension map, so they are never served), or look in each entry's built JS for a marker exported only by the other entry's feature folder. Then update the test.
3. **`Math.random` is allowed in `apps/client/src/**`** (`eslint.config.js:173-178`). The client block replaces the root `no-restricted-syntax` options, so the root's `Math.random` ban is gone along with the `Date.now` one. The plan's Global Constraints allow only the clock, `performance.now` and `getRandomValues`. Scenario: a future component builds an id with `Math.random()` and lint passes. Fix (via a plan amendment): add `{ selector: 'CallExpression[callee.object.name="Math"][callee.property.name="random"]', message: 'S35 j: use src/app/ulid.ts or crypto.getRandomValues' }` to the client block, plus a lint test case.
4. **Shared i18n table ships every entry's strings to every entry** (`apps/client/src/i18n/en.ts:2-5`). The admin-stock build contains `owner.*` text. That text is not code, so S35 a is not broken today, but the catalogue will grow with the owner app. Fix (optional, when task 63+ adds keys): split the catalogue per entry (`i18n/owner.ts`, `i18n/admin-stock.ts`, shared keys in `en.ts`), so each build carries only its own strings.
5. **The two `client-dist.ts` copies are duplicates by spec choice** (`apps/{hub,cloud}/src/lib/client-dist.ts`). §7.1 and §12.4 accept this. Nothing guards against drift except #78 running both. Fix (optional): add an assertion in #78 that the two files are identical apart from the `CLIENT_DIST_DIR` line and the one comment line, so drift is noticed when it happens, which is the §12.4 trigger.
