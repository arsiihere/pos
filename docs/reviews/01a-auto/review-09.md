CHANGES NEEDED

# 01a auto review — batch 09 (tasks 37–41)

Reviewer: independent; I did not write this code. Inputs: `docs/reviews/01a-auto/batch-09.md`, plan tasks 37–41, spec 01a v1.0 §3.2, §3.4, §4.2, §5.1, §7.3, §12.4, S5, S6, S17, S28, S29, S40 (N2, N4, N12), S42, S43, S48, tests 42–46, 49, 53, 54, 58, 94, 95, 126, 140. Commits `cc8290e`, `5f628e6`, `3f49853`, `3387815`, `8d48b38`.

## Verification run by the reviewer

- `pnpm test`: **113 files, 429 tests, all passed** (exit 0). Matches the batch report.
- `pnpm lint` (`eslint .`): **clean**, no warnings or errors.
- Files per commit match each task's Files list. No `package.json` or lockfile change in the batch, so there is no new dependency.

## What checks out

- **§5.1 migration** `0004_restaurant_config.sql` is the spec SQL word for word (tables, triggers, comments).
- **Projections** (`projections/branch-config.ts:21-38`, `item-availability.ts:4-18`): times come from `event.recorded_at` and never from the clock, and both have `reset`. `itemAvailability` returns early for `[]` and otherwise runs one `json_each` statement. A missing row reads `true` (S17).
- **`loadBranchConfig`** (`branch-config.ts:55-75`) does 2 primary-key reads and returns NONE / BODY_MISSING / APPLIED as §3.2 says.
- **HTTP client** (`config-client.ts:19-46`): query, `Bearer` header, `accept-encoding: gzip`, `AbortSignal.timeout(30_000)`, reads the body with `text()` and never `json()`. `5xx` or a thrown fetch → `offline`; `304` → `not_modified` (§3.4 step 3, S48).
- **Poller order** (`config-poller.ts:123-157`): `JSON.parse`, then the envelope, then (i) the raw hash, (ii) the schema version, (iii) Zod, (iv) forward-only. All of this runs before `writer.run` (S28 d, S48 d). The config and directory parts share one `writer.run` (S5, S6). The swap happens in `tx.onCommit` (D45). The event has `actor_id: null` and `device_id: 'hub'`. `previous_config_version` comes from the projection row. One in-flight promise (#54). `not_ready` makes no HTTP call (S40 N4).
- **Logging** (§7.3): only issue path and code for a malformed envelope (`config-poller.ts:134`). No body or directory in any log line. Test #126 checks a real `$argon2id$` string and a non-string `pin_hash`.
- **Hooks** (`branch-config-holder.ts:30-42`, `config-poller.ts:203`): signature `(prev, next, tx)` (S40 N2). The hook runs inside the transaction after the append, and a throw propagates (S43).
- **Tests**: each numbered test is cited once and checks the stated case. #42 checks that `branchConfig()` is still `null` in `beforeCommit`. #95 builds a real stripped-hash collision. #140 uses real `fetch`, gzip and a 304 without `Content-Encoding`.
- **Tenant scoping**: the hub uses only its own `branch_id`, and the cloud side is unchanged. No client code in this batch, so no XSS surface.
- **Task 40 TDD ruling (batch note 1): accepted.** Task 39 says "§3.4 steps 1–6", so the behaviour came in with it. Then 4 mutations, each turning its test red, plus a test-only commit is a fair stand-in for red-first. No change needed.
- **Rulings 3–8**: consistent with the spec. The spec doesn't cover a non-401 4xx; logging it at `error` and recording `offline` is reasonable, see Nit 2.

## Blocker

None.

## Should-fix

1. **A rejected config part is never logged when the directory part applies.** `apps/hub/src/sync/config-poller.ts:149` and `:171-177`.
   - Scenario: a `200` has a bad `snapshot_hash` (or `schema_unsupported` / `schema_invalid`) and also a newer directory. `reject()` sets `last_problem` but writes no log line. The poll then finishes as `applied` at `info` with no `reason`.
   - §7.3 says `rejected` is logged at `error`. In this case the danger banner shows `hash_mismatch`, but nothing in the hub log says so or says when.
   - Only the path with no directory part logs at `error`, at `:151`, and that is the only path the §7.3 test checks.
   - Fix: when `configRejected !== null`, log at `error` once, e.g. `deps.log.error({ outcome: 'rejected', reason: configRejected }, MSG)`. Do it at `:149` or in the `applied` finish. Then add a case to the `[01a §7.3]` test: hash mismatch plus a newer directory → one `error` line with `reason: 'hash_mismatch'` and one `applied` line at `info`.

## Nits

1. **§3.4 step 2 and `loadBranchConfig` disagree on a stored body with a different schema version.** `config-poller.ts:240-245` checks only the row's `snapshot_schema_version`. `branch-config.ts:66-67` also checks the body's own version (S28 b: "a stored body whose `snapshot_schema_version` differs … `config_version` 0").
   - Scenario: row schema 1 but body schema 2, the state built in `restaurant-projections.int.test.ts` ("v2Body"). Boot gives BODY_MISSING, yet the poll sends `config_version=6`. The cloud answers `304`, so the hub never gets a config.
   - Today the row and the body always carry the same version, so this can't happen yet. Test #48 (later task) covers this exact case.
   - Fix: build `currentConfigVersion` on `loadBranchConfig` (state ≠ APPLIED → 0), or add the same body check there, so both rules come from one place.
2. **A non-401 4xx is recorded as `offline`** (`config-poller.ts:119-120`). Config status will then say "offline" for, say, a `403` or `404` from a wrong `cloud_base_url`, even though the cloud is reachable.
   - The spec doesn't cover this, and the batch report flags it as a ruling.
   - Suggest adding it to §12.3 open questions so the spec decides between `offline` and an `unauthorized`-style `last_problem`.
3. **`at()` is read more than once per poll** (`config-poller.ts:100`, e.g. `:129`/`:130`, `:167`/`:168`). With a real clock, `last_problem.at` and `lastPoll().at` can differ by a few ms. The fixed test clock hides this. Fix: read `const now = deps.clock.branchNow()` once after the fetch and use it everywhere.
4. **`loadBranchConfig` parses the stored body twice** (`branch-config.ts:66` `JSON.parse`, then `parseStoredSnapshot` at `:71`). At 5 000 items that is a second parse of about 2.5 MB at boot. Fix: parse once and pass the parsed value to `BranchConfigSnapshotSchemaV1.parse`.
5. **#94 "restart parses the stored body" calls `loadBranchConfig` directly** (`poller-schema.int.test.ts:72-74`). It doesn't actually restart the hub. That's acceptable until boot step 5 wires it (task 45), but task 45 should run #94's last assertion through a real `boot()`.
