# 01a auto batch 13

Tasks committed since the batch 12 report (`d3d96bd`). The batch 12 review (`e8b430b`) came in between; it is not a task.

| Task | Commit | Progress commit |
|---|---|---|
| 57 `apps/client` scaffold, build, ULID helper | `10a1619` | `1269884` |
| 58 `apps/client` lint rules | `10f91f1` | `b126716` |
| 59 `client-dist`, `admin-page` group, `/owner/*` allowlist, CSP on both | `0168625` | `461de88` |

**Tests:** 490 before, 502 after (`pnpm test`, 134 files, Postgres on 5433; the root `test` script now runs `pnpm --filter @pos/client build` first). Every new test failed first for the stated reason (missing module, missing build, no lint block, route 404), then passed. Typecheck passed after every task. **Lint was red between task 57 and task 58** (see 1). No file outside a task's Files list was changed.

**STOP at task 60.** `apps/hub/deploy/ship-client.sh` is written but **left uncommitted** (untracked, mode 755). The sandbox refused to run `bash` on it ("requires approval"), so the task's step 1 and step 3 checks could not be run. Details and the exact checks to run are in `.auto/STOP`. Tasks 61+ were not started.

## Things the reviewer should look at

1. **Lint red for one commit (task 57).** `src/app/ulid.ts` calls `Date.now()` as S35 j requires, and the root F §6.7 rule refuses it until task 58 adds the `apps/client/src/**` block. Task 57's command list (`pnpm typecheck && pnpm test`) does not include lint, so I committed. `pnpm lint` is clean from `10f91f1` on. If every commit must lint clean, tasks 57 and 58 should swap in a future plan.
2. **#113's manifest clause is weak with Vite 8 (task 57).** The manifest lists only `index.html` and the six font assets; the TSX modules are bundled into the entry chunk and are not listed. So "no module under the other entry's `src/features/`" passes because there are no module keys to check. The test checks whatever the manifest lists. A stronger check (for example, a string that only the other entry's code contains, looked for in the built JS) would need a spec ruling.
3. **The `data:` check (task 57).** Minified React contains `{data:null}` properties, so a plain `includes('data:')` fails. The test looks for a real data URL: `/data:[a-z]+\/[a-z0-9.+-]+[;,]/i`.
4. **One flaky full-suite run (task 57).** The first `pnpm test` after task 57 had 1 failure in 494 tests. It did not reproduce in two later runs, and log noise hid which test it was. All later runs were green.
5. **Client lint block (task 58).** It is exactly the plan's block, placed last. Because flat config replaces the rule's options, `Math.random` and `performance.now` are also allowed in `apps/client/src/**`, not only `Date.now`. The plan's Global Constraints allow the clock, `performance.now` and `getRandomValues`. Nothing stops `Math.random` there; a reviewer may want a selector for it.
6. **`../` in client-dist tests (task 59).** light-my-request (like a browser) resolves plain `../` segments before routing, so `/t/assets/../index.html` reaches `/t/index.html` and is served. That is inside the build, so it is fine. A literal `../` reaches the handler only through an encoded slash (`..%2f`), and the test checks that such a request gets a 404, along with a plain `../` that escapes the prefix. Neither form can read outside the build, because only names listed at registration are served.
7. **Two copies of the helper (task 59).** `apps/{hub,cloud}/src/lib/client-dist.ts` are identical except for `CLIENT_DIST_DIR` and one comment line (§7.1, §12.4). Both throw `DomainError('ROUTE_NOT_FOUND')`, so each app's own error handler writes the envelope. Files outside `assets/` (only `index.html` today) get `no-cache`.
8. **Extra hub test (task 59).** `[01a §7.1] the hub serves /admin/stock/ from the built admin-stock entry under the admin-page guards` checks the real wiring: 200 with the CSP, guards `host, provisioned, guest`, and a guest-network address gets 403. The cloud registers `/owner/` last, so the allowlist order checked by `[00 §10 #76]` is login, refresh, health, `/owner/`, `/owner/*`.
9. **Placeholder entries.** `owner/main.tsx` and `admin/stock/main.tsx` render only a title until tasks 63 and 68. `i18n/en.ts` has two keys (`owner.title`, `admin_stock.title`).
