# 01a auto fixes: batch 16

Source: `docs/reviews/01a-auto/review-16.md` (no Blockers, 2 Should-fix, 5 Nits). Every finding is fixed; none rejected, no STOP.

| Finding | Outcome | Commit |
|---|---|---|
| S1 a refused stock query leaves a blank page | Fixed. A non-network error on `GET /admin/queries/stock` (403, 409, 500) now shows a danger banner with the `errorMessage` text (`admin_stock.errors.PERMISSION_DENIED` for 403). The banner clears on the next good answer. It is kept in its own `queryError` state, so the post-save refresh does not wipe the "Saved" message. Test `[01a §8.2] a 403 on the stock query shows the permission text` (failed first). | `979c88a` |
| S2 two §8.2 gaps not in the parked list | Fixed. Two lines added to `parked.md`: `category_name` in `items_meta` and `day_min_gap_hours` for the `opened_recently` text. No code change until the spec is patched. | `3a11f49` |
| N1 duplicate `#133 page part` test name | Fixed. The second test is renamed `[01a §8.2, S33] …`. | `769ab09` |
| N2 roster lock uses the device clock | Fixed. `locked: s.locked_until !== null`, because the hub already sends null for expired locks. New test with the device clock 3 h fast (failed first). | `675e399` |
| N3 Add retry after 409 not tested | Fixed (test only; the code already handled it). Add → 409 → Start day → the same `command_id` is re-sent with the same payload. | `8b21d8a` |
| N4 out-of-order refreshes | Fixed. A `latest` request counter, as in `MenuView`, drops answers older than the newest refresh. Test holds the first read and answers the 15 s read first (failed first). | `4cb7342` |
| N5 day line warns early | Fixed. The tone now uses the raw age, `ageMs > staleAfterHours × 3 600 000`, which matches §6.19's `day_stale`. The difference is only at exactly 16 h 0 min, not "a minute early". The test freezes `performance` so the hub clock stays at exactly 16 h (`ok`), then checks 16 h 1 min (`warn`). I checked that it fails against the old `>=` code. | `c9f8bdd` and `75bc378` |

Note on N5: `c9f8bdd` was committed while its new test still failed. Under real `performance.now` the hub clock runs a few ms past 16 h, so the test could not see exactly 16 h. A follow-up commit, `75bc378`, freezes `performance` in that test. Earlier commits were not amended.

Note on the working tree: another session committed parked-item fixes in parallel during this run (`2148812`, `4448e72`, `6d0ca38`, plus the hash/units changes). This run staged only its own files.

## Verification

- `pnpm test`: 149 files, **569 tests, all passed**.
- `pnpm lint`: clean.
