# 01a whole-module check (2026-10-26 wrap-up)

I read every `review-01…16.md` and `fix-05, 06, 09, 11, 14, 16.md`. This file lists each finding that was marked not fixed, deferred or rejected, and each Nit in an APPROVE review that no fix file answered. Each one is either **fixed** (with its commit) or **deferred**, with the reason. No finding was rejected as wrong.

The spec is `01_Restaurant_Setup_Spec_v1.0.1.md`.

## A. Marked "not fixed" or "deferred" in a fix file

| Source | Finding | Status |
|---|---|---|
| fix-05 N3 | A no-op PATCH still writes an audit row and bumps `config_version` | **Deferred, owner decision.** §6.4 / S26 do not say whether a no-op is a write. Today's behaviour is safe: the hub just downloads an identical snapshot. |
| fix-06 N1 | Archived items' routes survive a station type change | **Fixed** in task 30: a restored item's routes are re-checked (`service.ts` §6.15, `assertRoutes` on restore). |
| fix-06 N2 | Category `availability_windows` accepted and dropped | **Fixed** in task 31 (`windows.int.test.ts`, S47). |
| fix-09 N1 | §3.4 step 2 vs `loadBranchConfig` on a body with another schema version | **Fixed** by #48 (`poller-boot.int.test.ts`, BODY_MISSING path). |
| fix-09 N2 | A non-401 4xx from the cloud is recorded as `offline` | **Deferred, spec question** (§12.3). No cloud route returns that today. |
| fix-09 N5 | #94 checks the restart with `loadBranchConfig`, not `boot()` | **Deferred.** Boot step 5 is exactly `loadBranchConfig`, and real `boot()` restarts are covered in `poller-boot.int.test.ts`. #94's own clause (unknown fields kept in the stored body) is a parse property. |
| fix-11 N3 | #63 uses the fixture `R_MGR`, not the real default roles | **Covered.** `apps/cloud/test/default-roles.test.ts` `[01a S18]` asserts that Owner and Manager have `manage-stock`. Existing tenants are covered by `0003` (below). |
| fix-14 S2 | Hand-written TS interfaces instead of `@pos/events` schemas | **Fixed** by D5 (task 64b, `404a07d`). Spec v1.0.1 §7.7 names the location. |
| fix-14 N2 | `ship-client.sh` treats `activating` as stopped | **Fixed** by D6 (`3ebaeda`, `b2c8f8c`). Spec v1.0.1 §7.8 (b). |
| fix-14 N3 | A rejected rename keeps the refused text | **Fixed** `4448e72` (FloorsView and StationsView `CommitField`). |
| fix-14 N4 | Concurrent logouts call `onLoggedOut` several times | **Fixed** `6d0ca38`. |
| fix-16 | All of review-16 | Fixed by the batch-16 run (`fix-16.md`). Its S2 parked two spec gaps, listed in C below. |

## B. Parked list (`parked.md`)

Every item is closed except the two spec gaps in C:
- `32bd361` money safe-integer check;
- `2148812` manage-stock backfill migration `0003`;
- `7b4e3fe` formatQuantity guard;
- `2c6abbe` canonicalJson guard;
- `4448e72` field reset;
- `6d0ca38` single logout;
- spec v1.0.1: §4.3 station order, §7.8 (b), §6.21.

## C. Open: need an owner decision (behaviour change, spec-first)

| Source | Finding | Why deferred |
|---|---|---|
| review-16 S2 / parked | `/admin/stock` category filter shows raw `category_id`s, because §6.19 `items_meta` has no `category_name` | Adds a field to the §6.19 contract, so it needs a spec version first. |
| review-16 S2 / parked | The `opened_recently` text cannot name `day_min_gap_hours`, because neither §6.19 nor §6.18b returns it | Same reason. |
| review-02 N1 | `stockLevel` compares the frozen day unit with the current snapshot's threshold unit | The spec does not decide it. The options are to freeze the threshold in `BusinessDayOpened.units`, or to treat it as null when the units differ. |
| review-12 N1 | §6.19 `items[].unit` comes from `stockOf` (`'piece'` default), while the catch-up uses `dayUnits(...).stock_unit` | §6.19 does not name the source. The suggested fix (`dayUnits`) is a one-line change once it is decided. |
| review-08 N2 | `PUT { station_id: null }` with no route writes a `route_removed` audit and bumps | §6.16 / S26 are silent. Same class as fix-05 N3. |
| review-07 N5 | `group_label` (1–60) and `description` (≤ 300) limits are in code only | The limits should go into §3.3 at the next spec revision. Code and page agree today. |
| review-07 N3, review-10 N4 | D3's wording versus later 01a tasks completing earlier 01a tests | Process ruling for the owner. Each such edit is recorded in its commit. |

## D. Nits fixed in this wrap-up

| Source | Commit |
|---|---|
| review-04 N2/N3: silent no-bump / no-audit | `55fef50` |
| review-08 N1: `route =await` | `9447360` |
| review-10 N5 / review-16 note: #63 1 000-append timeout under load | `2dffbd1` (test-only, D3) |
| review-15 N1/N3: minutes round-trip, threshold kept on unit change | `eb8e528` |
| review-15 N2: stale menu error banner | `e45c4c5` |
| review-15 N4: "Grams / Millilitres per piece" wording | spec v1.0.1 §8.1 |
| review-15 N5: minutes helpers in a view module | `92bcf2e` |

## E. Deferred Nits (no behaviour risk today, or a later module's job)

| Source | Finding | Reason |
|---|---|---|
| review-07 N1 | The restore re-check reads routes / stations through the JWT's branches, so a token older than a newly added branch skips that branch's check | Rare: it needs an access token older than an `issue-registration-code` run, plus an archived station on the new branch. The fix moves the re-check onto `TenantLevelRepository` and needs a branch-limited fixture. **Top of the list for 01b**, which adds branch admin. |
| review-01 N5 | #137's third case runs at 10:00, not the spec's 14:00 | Coverage is identical. |
| review-02 N2 | `business_day.units` aliases the event payload | `dayUnits` returns a copy, and nothing mutates state in place. |
| review-02 N3 | The lint rule bans `node:*` but not bare `crypto` / `fs` | Matches S35 k as written. A spec-first option for 02. |
| review-02 N4, review-03 N1/N3, review-04 N5, review-08 N5, review-10 N1/N2, review-12 N4 | Tests could be stricter (exact sequences, named constraints, barriers, test isolation) | Each is a test-strength improvement with no known false pass today. Pick them up when the file is next touched. |
| review-03 N2 | The 00 login timing test (`login.int.test.ts` 2× ratio) is flaky under load | Module 00. Seen once in 16 batches. A median-of-5 rewrite is a 00 follow-up. |
| review-04 N1, N4 | Idempotency follow-up SELECT may find no row; `client.release()` without the error | Needs a concurrent prune exactly between two statements, or a failed ROLLBACK. Both end in a 500 with no data harm. A T2 hardening item. |
| review-07 N2 | `insertConfigAuditRows` duplicates `writeConfigAudit` | Do it when a task's Files list includes `config-audit.ts` (01b `actor_kind`). |
| review-07 N4 | No test for the "one route per branch" refine | The refine exists. A one-case test for the next menu-items change. |
| review-08 N3 | The owner row is read before the branch lock (false 403 race) | The failure is safe (a refused write) and very rare. |
| review-08 N4 | `set-branch-settings` repeated option is last-wins | Ops CLI, run by hand. |
| review-10 N3 | `stock_version` moves after the after-commit hooks | Follows the plan. The same hook failure already skips the WS publish in 00. |
| review-12 N2 | Untracked items carry `stockOf` defaults | The page filters on `is_stock_tracked` (`AlertBar.tsx`, `StockTable.tsx`, `StockApp.tsx`). |
| review-12 N3 | The catch-up registry is not guarded against double registration | Happens only in tests (two hubs in one process). |
| review-12 N5 | #71 tests task-37 code | No change needed. |
| review-13 N1 | Lint was red at one historical commit | History only. |
| review-13 N2 | #113's manifest clauses see no bundled modules under Vite 8 | Needs a spec-first change to §10 #113 (sourcemap-based check). |
| review-13 N3 | `Math.random` is not banned in `apps/client/src` | Needs a plan amendment (lint rule plus lint test). Nothing uses it today. |
| review-13 N4 | The i18n catalogue ships every entry's strings | Text only. Split it when the catalogue grows (02). |
| review-13 N5 | Two `client-dist.ts` copies | Accepted by §7.1 / §12.4. |
