# 01a auto fix — batch 09 (tasks 37–41)

Input: `docs/reviews/01a-auto/review-09.md` (CHANGES NEEDED; 0 blockers, 1 should-fix, 5 nits).

## Blockers

None.

## Should-fix

| Finding | Result | Commit |
|---|---|---|
| S1: a rejected config part is not logged when the directory part applies (§7.3) | **Fixed.** Test first: the `[01a §7.3]` test now sends a hash mismatch with a newer directory. It expects one `error` line `{ outcome: 'rejected', reason: 'hash_mismatch' }` and then the `applied` line at `info`. Before the fix it failed because the `error` line was missing. `config-poller.ts` now logs the rejected part at `error` before it applies the directory part. | `81f49ec` |

## Nits

| Finding | Result | Commit |
|---|---|---|
| N1: §3.4 step 2 and `loadBranchConfig` disagree on a body with a different schema version | **Deferred, no code change.** The review says this state can't happen yet, because the row and the body always carry the same version. Test #48 belongs to a later task, which will cover it and is the right place for the fix. Not trivial for this batch. | — |
| N2: a non-401 4xx is recorded as `offline` | **Deferred, no code change.** The spec doesn't cover this case. Deciding it needs a spec change (§12.3 open question), and the implementer may not edit `docs/specs/`. Left for the spec owner. | — |
| N3: `at()` read more than once per poll | **Fixed.** The poller reads `deps.clock.branchNow()` once after the fetch, so `last_problem.at` and `lastPoll().at` match. `not_ready` reads the clock once on its own path. No behaviour change under the test clock; the existing tests stay green. | `5574fed` |
| N4: `loadBranchConfig` parses the stored body twice | **Fixed.** The parsed `raw` value goes to `BranchConfigSnapshotSchemaV1.parse`. `parseStoredSnapshot` stays exported because plan line 252 names it as an interface. A pure refactor, covered by the existing load tests. | `015e905` |
| N5: #94 calls `loadBranchConfig` instead of a real restart | **Deferred to task 45**, as the review suggests (boot step 5 is wired there). No change in this batch. | — |

## Verification

- `pnpm test`: **113 files, 429 tests, all passed.** The S1 case extends the existing §7.3 test, so the count is unchanged.
- `pnpm lint` (`eslint .`): clean.
