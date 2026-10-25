APPROVE

# 01a auto review: batch 15

Reviewer: independent, read-only. Scope: task 64b (`404a07d`), D6 (`3ebaeda`, `b2c8f8c`), task 65 (`8aeb80d`), task 66 (`9a014df`) and task 67 (`939e5d0`). For each one I read the plan section (`docs/plans/01a-plan.md:1030-1053`), D5 and D6 (`decisions.md`), the spec sections they cite (§7.7, §7.8, §8.1, S8, S11, S32, S34, S41, S44, S46, S47, S48, and §10 #75 / #139), and the diff.

## Verification (run by me)

- `pnpm test`: **143 files, 532 tests passed, 0 failed** (Duration 119 s). This matches the batch report (521 → 532). The module-00 `[00 §10 #53]` timing flake did not happen in this run.
- `pnpm lint` (`eslint .`): clean, with no warnings or errors.

## What I checked

**Task 64b (D5).** I diffed the old `apps/cloud/src/modules/restaurant/schemas.ts` and `owner-auth/schemas.ts` (from `404a07d^`) against `packages/events/src/admin/{restaurant,owner-auth}.ts`, ignoring whitespace. The move is verbatim. Every refinement, range and default is the same. The only changes are:
- the path params and `MenuQuery` stay in the cloud (`apps/cloud/src/modules/restaurant/schemas.ts:6-26`);
- `Name` and `AvailabilityWindows` are no longer exported;
- new `z.input` / `z.infer` type aliases.

There is no behaviour change. The new modules import only `zod` (browser-safe, as D5 requires). `apps/client/package.json` gains no dependency: types come from `@pos/events` through `import type`, so S35 g's closed list holds. D5 asked for one test per side:
- the cloud side has `apps/cloud/test/restaurant/admin-schemas.int.test.ts:22-45`. It parses real login, floors, stations and menu replies. `toEqual(parse(x))` also catches extra keys, because zod strips them;
- the client side has `apps/client/src/api/cloud-admin.test.ts:151-175`.

Both tests would fail without the exports (`undefined.parse`).

**D6.** `apps/hub/deploy/ship-client.sh:39-42` now refuses any state other than `inactive` or `failed`. An empty state also refuses (`${state:-in an unknown state}`), and ssh failure (rc 255) is still caught first. This matches D6. The §7.8 (b) text patch is still owed by Claude, as the report says.

**Task 65.**
- Freshness is shown only for batch stations, both in rows and in the add form (`StationsView.tsx:203-215`, `:339-348`).
- Programs are listed only under batch stations, and the add-program form appears only on a non-archived batch station (`:359-397`).
- Times are typed in minutes and stored as `_ms` (§8.1).
- Creating POSTs carry the form's ULID key and renew it after a success or on `IDEMPOTENCY_KEY_MISMATCH` (S35 j).
- PATCHes carry no key.
- The one plan test (`StationsView.test.tsx:111-179`) covers all three stated cases and the 409 → `errors.CONFIG_IN_USE` banner.

**Task 66.** Each §8.1 requirement is met:
- search `q` is sent 300 ms after typing stops (`MenuView.tsx:137-142`);
- the category filter and the Active / Archived switch work;
- **Load more** shows while `next_cursor` is set, and pages are appended and de-duplicated by `item_id` (`appendUnique`);
- only the latest request's answer is applied (`latest` ref);
- with `can_edit_tenant: false` there are no save controls and one info banner (S8).

The three plan tests exist once each and test what their names say: #75 (no `img` element), #139 page part, and S48 (fake timers at 299 / 300 ms, the cursor URL, a duplicate `I3` shown once). `403` maps to `errors.PERMISSION_DENIED` through `form.ts` `errorText`.

**Task 67.**
- "No tax" is first and the default, and it sends `null` (S34).
- Archived tax classes and categories are not offered, except the edited item's own (`ItemForm.tsx:302-310`).
- The program selects appear only for batch stations (S11). The program select has no empty option, which matches §3.3: a batch station requires `program_id`.
- "Sold by" offers only `piece` or the stock unit, so the S44 rule (different units → `sale_unit 'piece'`; equal units → 1) cannot be broken by the form.
- The unit-change warning is shown when any of the three unit fields differs from its starting value.
- The threshold goes through `QuantityInput` in the stock unit (S46). `carries_over` defaults to false (S41).
- `WindowsField` takes at most 4 rows in HH:MM, refuses equal times and wraps past midnight (S47).
- An edit PATCHes only the changed fields and PUTs only the changed routes (§6.15, §6.16).

All 5 plan tests exist once each, and each would fail without the form. The S44 test also checks the edit PATCH body exactly (`ItemForm.test.tsx:284-285`).

**Foundation §6 / security.**
- The client calls use the existing `cloud-admin` envelope and error mapping. No error codes were added.
- No cloud logic changed (imports only). Tenant scoping is unchanged and server-side.
- There is no `dangerouslySetInnerHTML`, `innerHTML` or `console.*` in `apps/client/src/features/owner`, and #75 covers markup in item names.
- No secrets or tokens are logged.

**Files.** Each task touched only its plan Files list, plus what D5 and D6 allow: the cloud schema move, one cloud test, and `ship-client.sh`. No `package.json` or lockfile changed.

## Blockers

None.

## Should-fix

None.

## Nits

1. **`apps/client/src/features/owner/menu/ItemForm.tsx:144-146, 284`: the minutes round-trip can rewrite times nobody touched.**
   - *Scenario:* an item has `cook_time_ms: 100_001`, written by a seed or the API rather than this form. `formatMinutes` shows "1.67", and `parseMinutes` gives back `100_200`. An owner who only edits the price then also PATCHes `cook_time_ms: 100_200`. The same applies to `prep_buffer_ms` and `stock_time_ms`.
   - *Fix:* keep the original text for each time field, and add the field to the patch only when its text changed (or when `parseMinutes(text) !== parseMinutes(formatMinutes(original))`).
2. **`apps/client/src/features/owner/menu/MenuView.tsx:120-131`: a load error is never cleared by a later successful load.**
   - *Scenario:* one network blip during a search leaves the "network" danger banner up after the next filter change succeeds.
   - *Fix:* call `setError(null)` in `load` when `result.ok`, or when the request starts.
3. **`apps/client/src/features/owner/menu/ItemForm.tsx:376`: the low-stock threshold keeps its number when the stock unit changes.**
   - *Scenario:* a threshold of 1 500 g becomes 1 500 pieces after the stock unit is switched to Pieces. The new value is visible, but nobody chose it.
   - *Fix:* reset `threshold` to `null` in `changeStockUnit` when the unit actually changes, as is already done for `saleUnit`.
4. **`apps/client/src/i18n/en.ts:100` and spec §8.1: the label does not match the spec's wording.**
   - *Scenario:* §8.1 calls the S44 field "Pieces per …", but the field is "Grams per piece" / "Millilitres per piece". The code is right by S44's definition: `stock_per_sale_unit` is the number of stock units one piece uses, an integer. The spec wording is loose, and the code departs from it with a note only in the batch report.
   - *Fix:* add a §8.1 wording fix ("Grams / Millilitres per piece") to Claude's pending spec patches, alongside D6 and D7.
5. **`apps/client/src/features/owner/stations/StationsView.tsx:24-31`: shared helpers live inside a view module.**
   - *Scenario:* `ItemForm` imports `parseMinutes` / `formatMinutes` from `StationsView.tsx`, so the menu feature depends on the stations view module. The batch report explains why (task 67's Files list has no shared helper file).
   - *Fix:* when a later task touches the owner feature, move them next to `money.ts` (for example `features/owner/minutes.ts`).

Review-14 nits 3 and 4 are still open, as the batch report says. Task 65's `CommitField` repeats nit 3.
