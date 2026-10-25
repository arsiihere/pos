APPROVE

# 01a auto review — batch 01 (tasks 4–8)

Reviewer: independent, did not write this code. Inputs: `docs/reviews/01a-auto/batch-01.md`, plan tasks 4–8, spec v1.0 §9, §4.2, S18, S27, S33, S44, S47, §10 #136, #137, #141, #150, and `git show` of `87431d3`, `5a59704`, `4d674db`, `426eec5`, `d8e2f9e`.

## Verification run by the reviewer

- `pnpm test`: **81 files, 278 tests, all passed** (46.85 s; Postgres up). This matches the batch report.
- `pnpm lint`: `eslint .` exited clean, with no errors or warnings.
- `git status`: clean apart from the untracked `.claude/settings.local.json.bak` named in the batch report.

## Per task

**Task 4 (`87431d3`, §9, S18).** `packages/domain/src/errors.ts:28-49` adds all 13 §9 codes with the statuses in the §9 table (7 × 404, `CONFIG_NAME_TAKEN`/`CONFIG_IN_USE`/`BUSINESS_DAY_NOT_OPEN` 409, `CONFIG_REFERENCE_INVALID`/`IDEMPOTENCY_KEY_MISMATCH`/`STOCK_NOT_TRACKED` 422). `permissions.ts:21` appends `'manage-stock'` last. `default-roles.ts` is unchanged: Owner is `PERMISSIONS.map`, Manager is everything except `manage-roles`, so both get the new grant. Cashier and Order taker have explicit lists without it, as S18 requires. The tests `errors.test.ts` "[01a §9]", `permissions.test.ts` "[00 §3.6, 01a S18]" (exact list plus a uniqueness check of 20) and `apps/cloud/test/default-roles.test.ts` are all present, and each would fail without the change. The commit touches only the plan's 5 files.

**Task 5 (`5a59704`, S44, #141).** `units.ts` parses digit strings with regexes (`[0-9]` only, so `"١"` fails), uses no `parseFloat`, pads to thousandths and checks `isSafeInteger`. Every #141 case is in `units.test.ts:6-23`, along with Review Focus 2 (`"1.5kg"`, `"1,5"`) and the root-export check. There is no `node:*` import. Only the plan's files changed.

**Task 6 (`4d674db`, S47, #136, #137).** `localTimeOfDayMs` is exactly the plan formula (`availability-windows.ts:11-13`) and never reads the runtime zone. `[start, end)` with wrap is at `:15-22`. `isOrderableByTime` ANDs the item and category windows (`:24-32`). The test sets `TZ=UTC` in `beforeAll` and asserts it took effect (`test.ts:38`). All #136 boundary cases are present, and #137's four function cases are present. Only the plan's files changed.

**Task 7 (`426eec5`, §4.2, S33, #150).** `line-total.ts:9-15` multiplies in BigInt and rounds half-up with `(p·q·2 + 1000) / 2000`. Non-integer and negative inputs throw. The defaults are 16 and 4, exported from the root. All #150 cases are present. Only the plan's files changed.

**Task 8 (`d8e2f9e`, S27).** `packages/domain/src/hash.ts` has `/// <reference types="node" />`, and `canonicalJson` throws `'canonicalJson: undefined'` at any depth (`hash.ts:10`). The subpath export `./hash` is not re-exported from the root (`index.ts` checked, and tested at `hash.test.ts:23-26`). `apps/hub/src/lib/hash.ts` re-exports both functions and keeps `payloadHash`. The only new dependency is `@types/node@22.19.1` (dev) in `packages/domain`, which is on the plan's list (S40 N1). The lockfile delta is only that entry. Hub command tests stay green, so no caller passed `undefined`.

**Foundation §6 and security.** These are pure domain functions: no envelopes, SQL, tenant scoping or logging are involved. There is no `Date.now`/`Math.random`/`ulid` in `src/`. Nothing under `packages/domain/src/**` except `hash.ts` imports `node:*`. There is no client code in this batch, so there are no XSS paths. No secrets are involved.

## Blocker

None.

## Should-fix

None.

## Nits

1. **`packages/domain/src/line-total.test.ts:13`: the "BigInt, exact" case does not tell BigInt and float apart.** 1 000 000 000 × 1 000 000 = 1e15 is below 2^53. The reviewer ran a float version, `Math.floor(p*q/1000 + 0.5)`, against every #150 case, and it passed all of them. So a later switch to floats would go unnoticed. *Fix:* add a case whose product is above 2^53 and whose exact remainder sits at a rounding boundary. For example, choose `p`, `q` with `p·q ≡ 499 (mod 1000)` and `p·q > 2^53`, assert the BigInt result, and check that the float version gives a different answer.
2. **`packages/domain/src/line-total.ts:13-14`: `Number(product)` silently loses precision above `Number.MAX_SAFE_INTEGER`.** Example: a `piece` line with `price_minor` 1e9 and quantity 1e7 returns a rounded value with no error. No 01a path reaches this, but 02 will call it with order quantities. *Fix:* throw when the result is not `Number.isSafeInteger`, the same way the inputs are checked.
3. **`packages/domain/src/units.ts:24-30`: `formatQuantity` does not guard its input.** `formatQuantity(-1500, 'g')` gives `"-1.-5 kg"`, and a non-integer gives a fractional thousandths string. Valid data is never negative (`on_hand ≥ 0`), but 02 and 03a will display derived numbers. *Fix:* throw (or format `Math.abs` with a sign) when `!Number.isSafeInteger(n) || n < 0`.
4. **`packages/domain/src/hash.ts:11`: `JSON.stringify(v) ?? 'null'` still writes `null` for a function or symbol value inside an object, where `JSON.stringify` would drop the key.** This is the same wire/hash mismatch class that S27 closed for `undefined`. Values that went through `JSON.parse` cannot contain these, so nothing is broken today. *Fix (optional):* also throw when `typeof v` is `'function'`, `'symbol'` or `'bigint'`.
5. **`packages/domain/src/availability-windows.test.ts:54`: #137's third case is evaluated at 10:00, while §10 frames all of #137 "at hub time 14:00".** Coverage is the same (the item is inside its window, the category is outside), so this only affects how closely the test follows the spec. *Fix (optional):* use an item window that contains 14:00 (for example `[13:00, 15:00)`) with the evening category at `hubAt(14)`.

Outside this batch (for whoever owns task 14 or the spec): `manage-stock` reaches only tenants seeded after this change, through `DEFAULT_ROLES`. Owner and Manager roles that already exist in the database do not get it unless a later migration or seed adds it. The spec does not say how this is handled.
