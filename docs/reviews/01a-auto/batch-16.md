# 01a auto batch 16

These are the tasks committed since the batch 15 report (`b5f9953`). Decision D7 (`a765e87`) and the batch 15 review (`305e928`) came in between; neither is a task.

| Task | Commit | Progress commit |
|---|---|---|
| 68 `/admin/stock`: `hub-admin` client and PIN login (with D5, D7) | `8f34f02` | `8d1acb8` |
| 69 `/admin/stock`: table, status, banner, alert bar, save, versioned poll, hours | `80294d2` | `cbbd714` |
| 70 `/admin/stock`: business day and Add | `aa1a90c` | `653c0b1` |
| 71 Manual runbook and release drill | **STOP**: needs hardware (`.auto/STOP`) | — |

**Tests:** 532 before, 555 after (`pnpm test`, 148 files, Postgres on 5433). Task 68 adds 8 tests (6 client, 2 hub), task 69 adds 10, task 70 adds 5. Typecheck, `pnpm lint` and `pnpm --filter @pos/client build` were clean after every task.

**Fail-first:** each new test failed first for the stated reason (module missing, `tenant_id` undefined, Start day / Add missing), with two exceptions:
- The D5 hub parse test (`[01a §7.7, D5]`) passed on its first run. The schemas were written just before it.
- The two `hub-clock.test.ts` tests were first run after the module existed. Moving the file aside to show the failure was not permitted in this session.

## Things the reviewer should look at

1. **D7 / D5 (task 68).**
   - `config-status` now returns `tenant_id` and `branch_id`, both `null` on an unprovisioned hub. Two exact-shape expectations in `config-status.int.test.ts` (#56 and not_ready) gained the two fields.
   - The hub admin schemas are in `packages/events/src/admin/hub.ts`: roster, admin auth, config status, stock query, the five command results, and `commandResponse(result)`. The hub routes still validate with their own payload schemas. The `*Payload` schemas there are loose and are used only for the client's types.
   - Files outside task 68's list (allowed by D5/D7): `packages/events/src/{admin/hub.ts,index.ts}`, `apps/hub/src/queries/config-status.ts`, `apps/hub/test/queries/{config-status,stock}.int.test.ts`.
   - The spec text for §6.21 still needs Claude's D7 patch.
2. **`hub-admin.ts` API choices.**
   - `readDeviceToken` has a sibling, `readDeviceId`, because the envelope's `device_id` must match the token. Both read IndexedDB `pos-device` / `device`.
   - The command envelope's ids are cached from the last `configStatus()`. A command sent before any read fetches config-status first.
   - `ADMIN_SESSION_REQUIRED` and `SESSION_EXPIRED` mean "signed out". StockApp goes back to the roster on any `signed_out` answer, so `main.tsx` passes a no-op `onSignedOut`.
   - PERMISSION_DENIED on the hub page uses its own text (`admin_stock.errors.PERMISSION_DENIED`) through `adminErrorKey`, because `errors.PERMISSION_DENIED` is the owner app's tenant-wide text.
3. **Spec gaps (no spec change made):**
   - **Category filter labels:** §6.19's `items_meta` carries only `category_id`, no category name, so the filter options show ids.
   - **`opened_recently` text:** §8.2 wants the text to name `<day_min_gap_hours>`, but neither §6.19 nor the §6.18b result returns that number. The text says "only a short time ago" instead of showing a possibly wrong default.
   - **Suggested fix for both:** add `category_name` to `items_meta` and `day_min_gap_hours` to §6.19, spec-first.
4. **UI kit:** there is no badge class. Badges ("Not counted today", "Hours …", "Off since …") are kit `Banner`s, which give an icon, a word and a tone. The close-day confirmation uses `.pos-scrim` / `.pos-dialog`.
5. **Task 69 rulings.**
   - A count whose `unit` differs from the day's stock unit, or that has no `set_at`, shows an empty On hand, and its Confirm is disabled.
   - The hours badge shows the item's own windows when the item is outside them, else the category's.
   - An Off item never shows the hours badge (Off wins).
   - "Off since" also shows while no day is open.
   - After a successful save, only the drafts still equal to the sent values are cleared.
   - #77 "edit back to the same number" clears the input, then types 5, because React fires no change for identical text.
6. **Task 70 rulings.**
   - Both Start day buttons (above the rows, and next to the save after a 409) do the same thing: open the day, then re-send the refused save or Add with its kept command_id.
   - Save counts is the primary button only while a day is open and nothing is blocked; otherwise Start day is.
   - The day line's tone is ok below `day_stale_after_hours`, warn from there (by age, not date), and info when the day is closed.
   - StockTable's new Add props are optional, so task 69's table tests did not change.
7. **Still open from review 15:** `parseMinutes` / `formatMinutes` still live in `StationsView.tsx`. No task in this batch touched the owner feature.

## STOP: task 71

Task 71 is the manual runbook and the on-site release drill. It is marked **needs hardware**, and its §7.8 steps need ssh to the pilot mini PC, which D4 denies. Task 72 (Claude only) writes `docs/manual-test-01a.md` from task 71's report, so it waits as well. Details are in `.auto/STOP`.
