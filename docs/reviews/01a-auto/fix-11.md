# 01a auto fix — batch 11

Reply to `review-11.md`.

## Blocker

None.

## Should-fix

1. **#133 / #145 do not test "without `manage-stock` → 403"** — **fixed** in `c20a6f4`.
   In `business-day.int.test.ts`, `open()` now seeds `S_OWNER.denied_permissions = ['manage-stock']`. S_OWNER keeps `access-hub-admin`, so the request gets past the admin route guard. #133 and #145 now send Open/CloseBusinessDay as S_OWNER and assert `403`, `PERMISSION_DENIED` and `details.permission === 'manage-stock'`. #145 also checks that the day stays open. The S_CASH guard checks are still there.
   To check the test, I changed both handlers to `permission: 'access-hub-admin'` for one run. #133 and #145 failed (`expected 200 to be 403`). I then put the handlers back; the source is unchanged. This is a test-only change.

## Nits

1. **`business_date` expected value copies the code's algorithm** — **fixed** in `aa4c04c`. The tests now assert the literals `'2026-10-25'` / `'2026-10-26'`, and the `localDate` helper is gone. The file also passes with `TZ=Pacific/Kiritimati`.
2. **#133 calls a direct fold a "restart"** — **fixed** in `5749f7a`. The comment now says it is the boot step 3 fold and points to #147 for the real `boot()` restart.
3. **#63 uses the fixture `R_MGR`, not the real default roles** — **not done**. The fix belongs in `apps/cloud/test/default-roles.test.ts`, which is a cloud file outside this batch's tasks. The real default (`default-roles.ts:28`) already includes `manage-stock`. This is left for a later cloud task or review.
4. **Task 50 edited test files outside its Files list** — no change needed (the reviewer agrees).
5. **Dead `setAt ?? now` fallback** — **fixed** in `f39dfde`. It now uses a non-null assertion, with a one-line comment saying why `set_at` cannot be null for an `added` entry.

## Final verification

- `pnpm test`: **122 files, 462 tests passed, 0 failed.** The count is the same as before, because the new checks went into existing tests.
- `pnpm lint`: clean.
