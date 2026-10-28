# 01a auto batch 15

These are the tasks committed since the batch 14 report (`099e659`). The batch 14 review (`f1cc4f0`), its fixes (`4f4c8d5`, `f40f525`, `7ffbbce`, `90f9f50`) and decisions D5/D6 (`578fefc`) came in between; none of them is a task.

| Task | Commit | Progress commit |
|---|---|---|
| 64b Shared admin schemas in `@pos/events` (D5) | `404a07d` | `97ef924` |
| D6 `ship-client.sh` ships only when the hub is inactive or failed (not a plan task) | `3ebaeda`, `b2c8f8c` | `7953d37` (build log) |
| 65 Owner stations view | `8aeb80d` | `a42b28f` |
| 66 Owner menu list: search, Load more, read-only start | `9a014df` | `c8e5b72` |
| 67 Owner item and category forms | `939e5d0` | `fff8171` |
| 68 `/admin/stock`: `hub-admin` client and PIN login | **STOP**, not started | — |

**Tests:** 521 before, 532 after (`pnpm test`, 143 files, Postgres on 5433). Tasks 64b, 65, 66 and 67 add 2, 1, 3 and 5 tests. Each new test failed first for the stated reason: in 64b the schemas were not yet exported (`undefined.parse`); in 65–67 the view or form module was missing. Each then passed. Typecheck and `pnpm lint` were clean after every task. One full run during task 67 failed the module-00 `[00 §10 #53]` login timing bound ("within 2×"). It passed alone and in the next full run, and task 67 changed no cloud code.

## STOP: task 68

The hub command route rejects a command with `BRANCH_MISMATCH` unless its `tenant_id` and `branch_id` match the hub's provisioned values (`apps/hub/src/commands/route.ts:78`). 00's admin pages are server-rendered with both values injected. The 01a `/admin/stock` page is a static Vite entry, and none of the endpoints it may call return them: `/admin/auth`, `/admin/login-roster`, §6.19, §6.21, and §6.23 (which needs a device session). So `hub-admin.ts` cannot build the §6.17–§6.18b commands without a spec change. The options are in `.auto/STOP`. The suggestion is to add `tenant_id` and `branch_id` to the §6.21 config-status response, spec-first, with its `@pos/events` schema per D5.

## Things the reviewer should look at

1. **Task 64b: the client derives no types with `z.infer` itself.** `apps/client` has no `zod` dependency, and S35 g keeps that list closed. So `@pos/events` runs `z.infer` / `z.input` and exports the types: `Admin*` for responses, `*Request` for bodies, plus `OwnerUser` / `OwnerLogin`. `cloud-admin.ts` keeps its old type names as aliases, so no view changed. `apps/cloud/src/modules/owner-auth/schemas.ts` was deleted because all of it moved. The cloud restaurant `schemas.ts` keeps only the path params and `MenuQuery`. The client's `MenuQuery` stays a plain interface: it is a query string, and the cloud coerces `limit` from text. The client does no runtime parsing, so there is no behaviour change. The new schema module names are generic at the package root (`CreateFloorBody`, `LoginResponse`, …); none collides today.
2. **D6** was applied as two small `fix(01a)` commits (logic, then the header comment), because D6 names no task. The spec text still needs Claude's patch to §7.8 (b).
3. **Task 65: minutes.** The freshness window and cook time are typed in minutes with up to 2 decimals (`parseMinutes` / `formatMinutes`). These are exported from `StationsView.tsx` because task 67's Files list has no shared helper file, and task 67 imports them from there. Edits save on blur or on a select change, as in task 64. `CommitField` and `SortField` duplicate task 64's private field components, because `FloorsView.tsx` was not in the Files list.
4. **Task 66: the scope of edits.** The list view edits only what has no task 67 form: add a tax class (rate typed in %), and archive / restore for tax classes, categories and items. All of these are hidden when the menu is read-only. Only the latest request's answer is applied. `MenuView` takes no branch prop: the menu is tenant-level, and the route picker reads `api.currentUser().allowed_branch_ids`.
5. **Task 67: rulings worth checking.**
   - The S44 field is labelled "Grams per piece" / "Millilitres per piece" and takes a whole number of stock units. I read the plan's "Pieces per …" as this field.
   - "Sold by" offers only Pieces and the stock unit, so the form cannot break the S44 rule.
   - The unit warning shows whenever any of the three unit fields differs from the form's starting values.
   - Choosing a batch station preselects its first active program.
   - An edited item keeps its own archived tax class or category as an option.
   - An edit PATCHes only the changed fields, then PUTs each changed route. It stops at the first error, so a PATCH that succeeded is not rolled back if a later PUT fails. The list reload on close shows the real state.
   - On `IDEMPOTENCY_KEY_MISMATCH` the form closes, and the list shows the mismatch text and reloads (review-14 Should-fix 1 pattern).
6. **Review-14 nits 3 and 4 are still open.** The rejected-rename text stays in the field, and concurrent logouts call `onLoggedOut` more than once. Task 65's `CommitField` has the same nit 3 behaviour as task 64.
