# 01a auto fix — batch 14

Fixes for `docs/reviews/01a-auto/review-14.md`.

| Finding | Result |
|---------|--------|
| Should-fix 1 — `IDEMPOTENCY_KEY_MISMATCH` traps the add form | **Fixed** in `4f4c8d5`. Failing test first (`FloorsView.test.tsx`: network failure → edited body → 422 → banner shows `errors.IDEMPOTENCY_KEY_MISMATCH`, list reloads, next submit has a new key). Added the `errors.IDEMPOTENCY_KEY_MISMATCH` text, an `isKeyMismatch()` helper in `form.ts`, and in both add forms (floor, table) a 422 mismatch now calls `renew()` and reloads the list. A retry with an unchanged body still keeps its key (#76 still passes). |
| Should-fix 2 — hand-written TS interfaces vs §7.7 "`@pos/events` schemas" | **Not fixed; STOP raised.** The review itself says to change no code until the owner rules. Both options need a human: (a) accept TS interfaces for 01a and record it in the plan or as a decision (implementers may not edit `docs/plans/`); (b) spec-first move of the admin response Zod schemas into `@pos/events`, which touches files far outside this batch. This must be settled before task 66 (`hub-admin.ts`), so `.auto/STOP` is written. |
| Nit 1 — `IP_LOCKED_OUT` has no text | **Fixed** in `f40f525`. Failing test first (`App.test.tsx`: a 429 `IP_LOCKED_OUT` login shows the lockout text). Added `errors.IP_LOCKED_OUT` with the same text as `LOGIN_LOCKED_OUT`. |
| Nit 2 — `ship-client.sh` treats `activating` as stopped | **Not fixed.** The script follows §7.8 (b) as written; changing it needs a spec change first. It is left for the owner, and for the task 71 release drill. |
| Nit 3 — a rejected rename keeps the refused text | **Not fixed.** It is not trivial: the commit callbacks would need to report success. Left for later. |
| Nit 4 — concurrent logouts call `onLoggedOut` several times | **Not fixed.** It is harmless today and not trivial. Left for later. |
| Nit 5 — weak `"L"` assertion | **Fixed** in `7ffbbce`. The test now asserts on the unit label element (`.pos-row span` is `L`). |

## Verification

- `pnpm test`: **139 files, 521 tests passed** (519 → 521).
- `pnpm lint`: clean.
