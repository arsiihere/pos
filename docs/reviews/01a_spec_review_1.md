CHANGES NEEDED

# 01a Restaurant Setup v0.5: hostile review 1

Reviewed: `docs/specs/01_Restaurant_Setup_Spec_v0.5.md` (DRAFT). Checked against foundation v1.7 §3.1, §3.3, §4.1, §4.7, §5.8, §5.9, §5.10 and all of §6; spec 00 v1.2 (M51, M59, M75, M81, `applyStaffDirectory`, boot steps); `stories-refined.md` (E1 stock); and the code at `apps/hub/src/lib/{boot,hash}.ts`, `engine-host/{writer,state-holder}.ts`, `projections/registry.ts`, `auth/{apply-directory,station-validator,pair-page}.ts`, `queries/registry.ts`, `apps/cloud/src/plugins/tenant-scope.ts`, `cli/issue-registration-code.ts`, `deploy/hub.service` and the package manifests.

Things that hold up: tests 1–113 are contiguous, and each number is used once. The lock order in S8 has no cycle for any pair of branch and tenant writes I tried. Commit-then-swap and the single writer make `registerStationValidator` and the swap of `branchConfig()` safe. PIN hashes stay out of the event log (`StaffDirectoryApplied` carries only counts and IDs). The 304 override (S4) and the station-name override (S10) are named.

---

## Blockers

### B1. S28 e makes the hub re-apply the same snapshot every 60 s (§3.4 step 2, S28 b/e)
**Failure:** The hub is upgraded to `SNAPSHOT_SCHEMA_MAX = 2` while the cloud still serves at most 1. This also happens whenever the cloud serves `v < hub max`. Step 2 sees the stored `snapshot_schema_version` 1 < 2, so it sends `config_version=0`. The cloud answers `200` with v1 (`min(2, 1)`). Step 4(iv) finds N > 0 and applies it. The stored schema is still 1, so the next poll repeats the cycle. The result is 1 440 `BranchConfigApplied` events a day, each pushed to every socket and synced by 06. Each one also fires `onBranchConfigApplied`, so 03a re-plans live reservations every minute, and the poll downloads about 85 MB a day, which S4 exists to prevent. Nothing in the spec marks this as a problem, so no banner is shown.
**Fix:** Do not signal through `config_version=0`. The hub sends its real `config_version` plus `held_schema` (the stored snapshot's schema version). The cloud answers `200` when `held_schema < v`, and `304` is allowed only when `held_schema = v` as well. Add a hub rule in step 4: a config part whose epoch equals the current one and whose `snapshot_hash` equals the current one appends nothing. Add a test: hub max 2, cloud max 1 → one apply, then `304`.

### B2. A failure inside the apply transaction silently stops both menu and staff delivery (§3.4 step 5, S6, §4.2 `onBranchConfigApplied`)
**Failure:** Step 5 runs the config part, the directory part and every `onBranchConfigApplied` hook (03a and 03b append events there) in one `writer.run`. Suppose a hook throws for one config (for example, 03a cannot handle a capacity change on an archived station). The same happens if 00's `applyStaffDirectory` throws, or a projection write fails. The whole transaction rolls back. The outcome is none of the eight listed in §6.21, `last_problem` is not set, no banner appears, and every 60 s the same poll fails again. The hub stops getting menu changes, and it also stops getting staff removals. That means the R14 BYOD revoke and the M50 PIN-change session ends never happen, for as long as the cloud data stays the same. Test 50 asserts this coupling ("forced failure → neither applied") as intended behaviour.
**Fix:** (a) Any exception in step 5 is recorded as `last_problem { outcome: 'rejected', reason: 'apply_failed' }`, logged at `error` and shown in the danger banner. (b) If the combined transaction fails, retry the directory part alone in its own `writer.run`, so a security revocation never waits on a menu apply. Keep S36's combined apply only for the epoch-changed case. Change test 50 to match, and add a test with a throwing hook.

---

## Should-fix

### S-1. The hash is computed over a value that is not what goes on the wire (S27, S28 c/d)
**Failure:** `canonicalJson` (`apps/hub/src/lib/hash.ts:9–12`) writes `{ a: undefined }` as `{"a":null}`, while `JSON.stringify` on the wire drops the key. Suppose the cloud adds an optional field, as S28 c allows, and the builder leaves it `undefined` on some rows. The cloud then hashes `"x":null`, the hub hashes the raw JSON without `x`, and every hub rejects every snapshot with `hash_mismatch`. That is exactly the freeze S28 was written to prevent. The same mismatch happens if the route's Fastify/Zod response serializer reshapes `snapshot`.
**Fix:** The cloud computes `snapshot_hash` over `JSON.parse(JSON.stringify(parsed))`, which is exactly the bytes it sends. `canonicalJson` throws on `undefined`. The `/v1/sync/config` response schema types `snapshot` as `z.record(z.string(), z.unknown())`. Extend test 85 with an optional field that is absent on one row.

### S-2. The first apply is labelled `epoch_changed` (§3.4 step 4(iv) vs S29 c, S36 b, test 111)
**Failure:** On the first poll, `current_config_epoch` is empty and so differs from the cloud's epoch. Step 4(iv) therefore labels the outcome `epoch_changed`. Step 5(b) then passes `allowNotNewer: true` and applies a directory whose version is not newer. Test 111 says this must be ignored. As a side effect, `pull-now` reports `epoch_changed` and the poll logs at `warn` on every new hub.
**Fix:** In step 4(iv), the outcome is `epoch_changed` only when `current_config_epoch` is non-empty and differs from the cloud's. On the first apply it is `applied`.

### S-3. Yesterday's count is sold as today's stock, and the assumption is not isolated (S14, S30, §4.4 05, E1 stock AC1/AC6)
**Failure:** `on_hand` carries over across business days. At 23:00 the pot shows 4. The food is thrown away at closing. At 12:00 the next day, before anyone counts, ordering screens show "4 left", and 03a quotes `stock_time_ms` ETAs for food that does not exist. The only warning is a badge on `/admin/stock`, a page order takers never see. AC1 says the count is entered "at the start of service", and AC6 says no count means 0. The spec makes the carry-over choice without an [ASSUMPTION] tag. The real answer (owner question 4) touches S14, S30, §4.4 05 (day close writes `StockSet 0`, so a billing module would write stock events) and 03a.
**Fix:** Add one decision, tagged [ASSUMPTION, Q4]: `availableStock(state, itemId, businessDayStartMs)` returns 0 when `set_at` is before the current business day. The engine stays pure, because the start time is a parameter. If the owner says leftovers are sold, only that function changes. Remove the day-close `StockSet` requirement from the 05 row.

### S-4. A re-count equal to the stored value records nothing (§6.17, §8.2, test 60)
**Failure:** The page sends "changed rows only", and the command appends a `StockSet` only when `on_hand` differs. Say the manager counts 4 in the morning and yesterday's value was also 4. Then no event is written, `set_at` stays at yesterday, and "Not counted today" never clears. With the S-3 fix applied, the count would also read as 0. The manager has no way to confirm a count.
**Fix:** The page sends every row the user touched or confirmed. The command appends `StockSet` for every entry it receives. Test 60 changes to: an equal `on_hand` still appends an event and moves `set_at`.

### S-5. A count lower than the reserved units is not handled (S14, §4.4 03a)
**Failure:** Start with `on_hand 5, reserved 5`, then a count of 3. `available` is 0, which is correct. But the 5 orders already reserved keep their stock-time ETAs for 2 units that do not exist. When the step that hands a unit over removes it from both `on_hand` and `reserved`, `on_hand` goes negative. No invariant stops this.
**Fix:** Add to the §4.4 03a row: a `StockSet` with `on_hand < reserved` re-plans the `reserved − on_hand` most recent reservations at full cook time (D23), and the fold keeps `on_hand ≥ 0`. State that invariant in S14 and add a unit test.

### S-6. Open orders can reference config that has left the snapshot (§4.3 "only active rows", §4.4 02, S31, D25)
**Failure (tax):** A line copies `tax_class_id X`. The owner moves the item to class Y and archives X, which is allowed because X no longer has an active item. X then leaves the snapshot, so at bill close 05 cannot resolve the rate for the open bill (S31).
**Failure (programs):** A batch line copies `program_id` but not the program's `cook_time_ms` (§4.4 02 row). If the program's time is changed or the program is archived mid-service, the ETA of an open order changes or cannot be computed, which breaks D25.
**Fix:** Keep archived tax classes and programs in the snapshot with `is_archived: true`, as S22 already does for stations. Add `program_cook_time_ms` and `stock_program_cook_time_ms` to the 02 copy list.

### S-7. An owner limited to some branches can change the whole tenant's menu (S8, S19, §6.12–6.15, S40 N3)
**Failure:** `allowed_branch_ids` is per owner and can be a subset of the tenant's branches (`issue-registration-code.ts:68` appends branches one at a time). An owner limited to branch A can still change prices, archive items and archive tax classes, and every change applies at B and C. That breaks the branch dimension of D30.
**Fix:** A tenant-level write requires the JWT's `allowed_branch_ids` to cover every branch of the tenant. `bumpConfigVersion` already locks all branches, so check there: if any branch is missing → `403 PERMISSION_DENIED`. Add a cross-branch test.

### S-8. The hub `503` overrides F §6.2 without saying so (§6.20, S24, S40 N5)
**Failure:** F §6.2 says 503 is "cloud only; the hub has no remote dependency on its request path". `pull-now` returns `503` from the hub. S24 overrides only §6.3, and S40 N5 overrides only 01a's own §6.20. That breaks the D64 naming rule.
**Fix:** Either return `200 { outcome: 'offline' | 'unauthorized' }`, which is simpler and already matches N5's "the hub decided" outcomes, or name the F §6.2 status-map row in S24.

### S-9. The stock fold and config load have no place in the real boot order (S15, §5.1, `lib/boot.ts`)
**Failure:** `registerBootStep('3')` handlers receive only `{ config, db }` (`boot.ts:36–40`) and run at `boot.ts:122`, before `createDeps` creates the state holder with `{}` (`boot.ts:278`). A step-3 fold therefore cannot hand its result to the holder, and following the spec literally loses every count on restart. The spec also never says at which step the in-memory `branchConfig()` is loaded. If it loads before step 4 (`projections.catchUp`), then after a USB restore plus the cloud tail (F §5.10) the hub boots on a stale `branch_config` row.
**Fix:** Add a §2 drift row or a decision: `createDeps` takes the initial state (or `BootContext` carries a state slot), and the stock fold runs there. `branchConfig()` and the station validator load after step 4. Extend test 47 to cover a stale projection.

### S-10. The hub release is not fully specified (S39 d/e, §7.8)
**Failure:** (a) Step 3 assumes `ssh` from the developer machine to a hub on restaurant mobile data. No spec defines that network path or the hub's git credentials for step 1, and the README's milestone C says remote hub updates are "none specified yet". (b) Between step 1 (new code checked out) and step 4 (restart), any restart (a power cut, or `Restart=always` after a crash) boots the new code with the old `admin-stock` build, or with none. That is exactly the mismatch S39 e claims cannot happen. (c) Nothing keeps a release out of service hours (compare F §6.8 for migrations).
**Fix:** State that the release is done on site over the LAN, outside service hours. Reorder the steps: `systemctl stop hub` → checkout → `install --prod` → `ship-client.sh` → `start`, so code and page change together.

### S-11. Some cloud routes have no happy-path test, and PATCH validation is incomplete (§10.2, F §6.7)
**Failure:** F §6.7 requires a happy path for every cloud route. These have none: `PATCH …/tables/:id` (rename, move floor, archive, and the "allowed with an open order" rule; only the 404 is tested), `POST …/programs`, `POST`/`PATCH` tax classes, and `POST` categories. Separately, a `PATCH` that lowers `cook_time_ms` below the stored `stock_time_ms` hits the SQL CHECK and returns `500 INTERNAL_ERROR` instead of `422`.
**Fix:** Add the missing tests. State that PATCH rules (§3.3) are checked on the merged row, and add a test for that case.

### S-12. The `request_hash` is undefined, and the 24 h prune runs inside the create transaction (S7)
**Failure:** If `request_hash` covers only the body, the same key used for `POST …/branches/A/floors` and then `…/branches/B/floors` replays A's response, and B's floor is never created. The prune `DELETE` runs inside every create transaction and takes row locks outside S8's lock order. Two concurrent creates then serialise on the old rows, and can deadlock if the plans scan them in different orders.
**Fix:** Define `request_hash = sha256hex(canonicalJson({ method, path_with_params, body }))`. Prune with `DELETE … WHERE ctid IN (SELECT ctid … LIMIT 100 FOR UPDATE SKIP LOCKED)`, or after COMMIT.

---

## Nits

1. Test 1 asks for "exactly 1 SQL statement", but the `branch-key` guard runs its own lookup first (`tenant-scope.ts:51`, `branchByApiKeyHash`). Say "1 statement after the tenant guard".
2. §5.1 does not say where `item_availability.changed_at`, `branch_config.applied_at` and `epoch_changed_at` come from. Each must be the event's `recorded_at`, or test 47's rebuild equality and S30's "Off since" differ after a replay.
3. In §6.14, `tax_class_id` is shown with no type, so it is unclear whether it may be null or omitted. Write `tax_class_id: string | null` (required key, null means no tax), to match S34 and the "No tax" default in §8.1.
4. §6.1 step (1) reads `config_version` outside the `REPEATABLE READ` that the builder uses. Run it inside the same transaction, so the version label always matches the content.
5. The browser needs ULIDs for `Idempotency-Key` and `command_id`. `ulid` is not on S35 g's closed list, and `crypto.randomUUID` needs a secure context, which the hub's plain HTTP is not. Name a hand-written `getRandomValues` ULID helper, following `pair-page.ts:207`, and give its place in §7.7.
6. The CSP in S21 has no `base-uri 'none'` or `form-action 'self'`, and `default-src` does not cover either. The hub's `/admin/stock` keeps its admin token in `sessionStorage` (as 00 does, `admin-bootstrap.ts:132`) with no CSP at all. Send the same header there.
7. `jsdom` 30.1.3 needs Node ≥ 22.22.2, but the root `engines` is still `>=22 <23` (`package.json:7`). Raise it so CI fails early.
8. §12.1 says "no new dependencies in `apps/hub`", but the hub must add `@pos/engine: workspace:*`. Say so.
9. For batch routes, the item's `cook_time_ms` and `stock_time_ms` are not used (the program decides), yet §3.3 still requires them and checks `stock ≤ cook`. Say which item fields are ignored at a batch station.
10. §7.3 should also say that a `malformed` envelope never logs Zod issue inputs. The envelope carries the directory, which holds PIN hashes.

---

## Assumption isolation

- S10 (parking as tables, Q1): if the owner says yes, parking orders take table locks. That contradicts F §5.9 ("takeaway, parking and delivery orders have no table; no lock check") and E2 AC9 ("parking (car description)"), and S10 does not name F §5.9 as overridden. Name it, or keep parking as an order type until Q1 is answered.
- S30 / §4.4 05 (Q4): not isolated. See S-3.
- S32, S33, S34 (Q3, Q11, Q7): isolated. A different answer changes one column default or one 02/05 row.

---

## Cut candidates (milestone A = one branch, 2026-12-20; cloud restore is 06, milestone B)

1. **S29 epoch, S36 directory resend, the 00 v1.3 `allowNotNewer` change, `epoch_changed_at` and its banner, and tests 99–101 and 109–112.** Replace them with one CLI, `restore-bump`. After a cloud restore it raises `config_version` and `tenants.directory_version` above any value from before the restore (for example + 1 000 000). The forward-only rules then work unchanged, and spec 00 needs no behaviour change. Doing this also removes S-2.
2. **The rest of S28 b/e (one builder per version, `SNAPSHOT_SCHEMA_MIN_SERVED`, `SNAPSHOT_SCHEMA_UNSUPPORTED`, `upgrade_required`, tests 96–98).** There is one schema version, and one developer updates three hubs. Keep S28 c/d (hash over the raw JSON, non-strict parse). This also removes B1.
3. **`POST /admin/config/pull-now`** (S24, §6.20, S-8). The 60 s poll is enough for the pilot. Keep one status line on the stock page.
4. **The `--business-day-start` option of `set-branch-settings`** until owner question 11 is answered. The 05:00 default needs no CLI. Keep `--tax-enabled`, because 05 is in milestone A.

Keep: `config_audit` (T2), the snapshot, catch-up and `GET /queries/branch-config` (02 needs them on day one), and `apps/client` with the shared `PinPad` and `StaffTiles` (02 reuses them).

## Missing for 02/03a

- The program cook times in the order-line copy, and archived programs and tax classes kept in the snapshot (S-6).
- Stock that is valid only for the current business day, decided in one place in `availableStock` (S-3).
- The invariant when `on_hand < reserved`, and the re-plan when a count drops below the reserved units (S-5).
- Defined failure behaviour for `onBranchConfigApplied` hooks, so a 03a or 03b hook cannot stop config delivery (B2).
- Where the engine's initial state and the boot-time stock fold plug into `boot.ts`. 03a replaces this step and needs the slot defined (S-9).
- A browser ULID helper for `command_id`. 02's ordering client needs it on every command (Nit 5).
