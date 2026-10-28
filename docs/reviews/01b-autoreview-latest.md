VERDICT: BLOCKERS

# 01b batch review: fixes R-1–R-4, P-3/P-4 applied, tasks 56, 57, 58 (919484d..d619dff)

Checked against: foundation §6; 01b spec §3.8, R5, D-6, B20, §4.4 rows 9–13, §6.16, §7.5, §8, §10.9a #55, #71, #78, #96; 01a v1.3 §6.17, §6.17a, §6.18, §8.2 (the 01b-driven B20 paragraph) and S33; the plan's "Done when" for tasks 56–58; AD-32/AD-31 amendments and AD-33; P-3 and P-4 answers. I re-ran `pnpm vitest run apps/client/src/features/admin/stock apps/client/src/features/owner apps/client/src/app apps/client/src/i18n apps/cloud/test/role-names.test.ts apps/hub/test/auth/renamed-roles.int.test.ts apps/cloud/test/route-inventory.int.test.ts`: 36 files, 133 tests, all pass.

## Blockers

- **R-1 (Blocker, T56 / AD-33 is not Class B)**: `apps/client/src/features/admin/stock/StockApp.tsx:508-516`; `docs/reviews/01b-auto-decisions.md` (AD-33).
  - **Problem:** under `manage_stock_scope: 'my_stations'` with no business day open, the page replaces the whole stock view (rows, `StockTable`, `ActionBar`) with the `StockCounterNotStarted` warn screen. The approved specs say something narrower:
    - 01b §4.4 row 11 / 01a v1.3 §8.2: the page "shows only the rows the stock query returns".
    - 01b §4.4 row 13 / 01a v1.3 §8.2: under `my_stations` the page **hides Start day, Close day and the stale-day prompt**, and a `409 BUSINESS_DAY_NOT_OPEN` shows the sentence.
    - 01a §6.18 `SetItemAvailability` does **not** need an open day. Only §6.17 and §6.17a answer `409 BUSINESS_DAY_NOT_OPEN` (01a §9 table, S33).
  - AD-33 therefore removes behaviour that 01a §8.2 (another module's approved spec, as amended by 01b) grants. A `my_stations` counter can no longer turn an item Off or On while no day is open. AD-33 follows a design screen against the spec text. That is the same pattern as AD-31 / P-4 (design vs 01a S50 a), which the previous review ruled Class C. The build log's "Design vs spec" line lists only the missing names ("like Imran", stations). It does not record that the rows and toggles are hidden.
  - **Failure scenario:** 09:30, the manager has not arrived and no day is open. Usman (Drinks counter, `manage-stock` scope `my_stations`) finds the lassi machine broken and opens `/admin/stock` to mark Lassi Off. He sees only "The day hasn't been started. Ask someone who can start the day." and has no rows and no switch. The hub would have accepted `SetItemAvailability`, so cashiers keep selling Lassi until someone with `branch` scope arrives.
  - **Required fix (either):**
    - (a) Keep the rows under `my_stations` with no day open, with no Start day. Put the warn notice (title + spec sentence) above them, as a banner or callout. Count entry may stay disabled or answer the 409 sentence, but the availability switch must work. Add a `[01b §4.4 row 11]` test: with `my_stations` and no day, a row's Off switch sends `set-item-availability`.
    - (b) Park it as P-n (design hides the rows vs 01a §8.2 / §6.18), restore (a)'s behaviour until it is answered, and amend AD-33 to say so.

## Should-fix

None.

## Nits (non-blocking)

- N-1 (T56): `apps/client/src/i18n/en.ts` `admin_stock.counter.note` says "Starting and closing the day is for the manager." That is role-named copy (R5 spirit, not the #55 literal grep). After a tenant renames "Manager", the text names a role that no longer exists. Say "for someone who can start the day", matching the spec sentence.
- N-2 (T56): `stock-pages.test.tsx` outside_scope fixture sends `{ reason: 'outside_scope', required_scope: 'my_stations' }`. For item commands the hub sends `{ permission, reason: 'outside_scope', item_ids }` (01b §4.4 row 9); `required_scope` is only on day commands and is always `'branch'`. Use the real shape.
- N-3 (T56): with `my_stations` and no day, kept or typed counts (S55 callout, drafts) are hidden behind the warn screen with no hint that they are still held. This goes away with R-1 (a).
- N-4 (T57): #96 and the route inventory passed on the first run. The log says #96 was seen to fail by mutation. That is acceptable for regression guards, but the plan's Step 2 "FAIL for the stated reason" was not observed for the route inventory at all.
- N-5 (R-4 fix): on the phone, `onNavigate` and Sign out close the nav overlay before `leave()` runs the discard guard. If the owner cancels the discard prompt, the nav is gone and they must reopen it. This is cosmetic.

## Checked and fine

- **R-1 fix (leave and archive dialogs):**
  - `OWN_ADMIN_ACCESS` goes through `ownAdminText(details)`.
  - `LAST_ADMIN_REQUIRED` names the branches from `details.branch_ids` via `useBranchName`, with the generic text as detail.
  - Tests cover both codes in both dialogs. The leave test also asserts that the generic text is absent.
- **R-2 fix (support number):**
  - `{support}` placeholder in every support text in `en.ts` and `ur.ts`. `supportText` fills it from `support.on` in the text's own language and falls back to English when there is no Urdu.
  - Every `{support}` key is rendered only through `supportText`. There is no other `t()` path, `errorKey` is used only in `form.ts`, and grep finds no raw `{support}` leak.
  - Urdu set and unset cases are tested. `admin_stock.problem.unauthorized` ("Call support.") is an 01a hub-page key, outside Q3's owner views.
- **R-3 fix (away hub):** the away notice now sits above B19's line. For an away hub that is not behind, the line shows "Up to date {time}"; when it is also behind, it shows the behind warning. `pending` still wins. The #78 case covers away only and away plus behind, asserting on the text, not the class.
- **R-4 fix:**
  - The runbook has the P-3 call-back: checklist number only, stop on no answer, written in the ticket without the password. The AD-29 questions are a pre-check only.
  - Phone nav per P-4 B: a Menu button in the app bar, and the side nav inside the kit `Dialog` (`role="dialog"`, `aria-modal`, Escape, Tab trap, focus return to Menu, all tested). Change password and Sign out are in the foot, and an item click closes the overlay and navigates.
  - The tab bar is removed under the human's answer. T47 and T50b are DONE, and P-3 and P-4 are marked RESOLVED.
- **T56, other parts:**
  - `manage_stock_scope` is read from the stock query, with no client filtering.
  - Close day and the stale prompt are hidden under `my_stations` with a day open. A 409 on save or Add shows the spec sentence, has no Start day retry and keeps the typed value.
  - `403 outside_scope` shows its text and refreshes.
  - Branch-scope behaviour is unchanged: the fixture only gains `manage_stock_scope: 'branch'`, and the existing tests pass.
- **T57:**
  - #55 has the exact §10.9a scope: `apps/*/src` (`.ts`, `.tsx`, `.sql`) and `packages/*/src` (`.ts`, `.tsx`), test files excluded, the six names in single or double quotes, case-sensitive, and only the three allowed files.
  - The regex is shown to hit planted lines and each allowed file. The T51 client fixture hit was fixed by renaming the fixture roles (Class A, tests only).
  - #96 compares `permissionsOf` (every permission), `ttlFor`, `adminPermissions`, `hasAdmin`, `/queries/session` minus `role_names`, roster membership and TestNoop outcomes in all four grant classes across two hubs.
  - The route list matches §6.16's 14 routes exactly. All 14 are `tenantScope: 'jwt'` and present in `ROUTE_CASES`.
- **T58:** the Progress table lists tasks 0–58 with commits, and the build log has entries for 1–57. README status reads "Implemented, pending page flows and release drill". T59–T60 are WAITING for the human, per the plan's STOP. T61 stays PARKED (P-2).
- **Scope:** no server code, migration, event, upcaster, API contract or error code changed in this batch. No test is skipped or weakened. The test edits in T57 only rename fixture role names.
