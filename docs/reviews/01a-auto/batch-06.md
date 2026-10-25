# 01a auto batch 06

Plan: `docs/plans/01a-plan.md`, spec `docs/specs/01_Restaurant_Setup_Spec_v1.0.md`. Decisions file read (D1–D3); D3 used once (task 26).

## Tasks committed since the last batch report (`713fee4`)

The batch 05 fix commits (`9d64905`, `d2bb567`, `b818f2a`, `e40f005`, `50efca1`) are covered by `fix-05.md`. No `feat(01a): task` commit came between `713fee4` and this session, so the list below is complete.

| Task | Commit | Progress commit | Tests added |
|---|---|---|---|
| 22 Cloud sync gzip | `3279dba` | `e54c89b` | `[01a S48]` gzip 200 gunzips to exactly the plain body and its hash matches; `[01a S48]` plain JSON without Accept-Encoding, a 304 without content-encoding |
| 23 Cloud tables | `2bccd2a` | `b1fd86c` | `#20`, `#21`, `#22`, `#118`, `[01a §6.6]` move to another branch's floor → 422 `wrong_branch` |
| 24 Cloud stations | `6c6b47e` | `7d8c089` | `#24`, `#25`, `#26`, `#27`, `[01a S10]`, `[01a §6.9]` rename/restore |
| 25 Cloud batch programs | `671d559` | `1e81533` | `#28`, `#29`, `#30`, `#119`, `[01a §6.10]` program_id in use → 409 |
| 26 Cloud tax classes, categories | `53eb634` | `4d9a8e9` | `#31`, `#32`, `#120`, `[01a S8]` category create bumps all three branches |

Every task: its tests failed first for the stated reason (missing route: `404 ROUTE_NOT_FOUND`; task 22: no `content-encoding`). Then `pnpm test`, `pnpm lint` and `pnpm typecheck` were green before each commit. Each new route has a `ROUTE_CASES` entry naming tenant B's ids.

## Test count

- Before: 92 files, 344 tests (after fix-05).
- After: 97 files, 366 tests, all passing.

## Rulings and anything odd (for the reviewer)

1. **D3 change to a 00 test (task 26).** `[00 §10 #77]` failed because `PATCH /v1/admin/tax-classes/<B id>` answers `404 TAX_CLASS_NOT_FOUND { tax_class_id: <B id> }` (spec §9 details), which echoes the id the caller sent. The test now exempts strings inside `error.details` that the request itself sent (path segments or payload strings). Every other B id is still forbidden anywhere in the body. The test also asserts `404` for the two tenant-level PATCH routes. This is recorded in the commit message and the build log.
2. **Pre-existing spec drift, not changed here:** `FLOOR_NOT_FOUND` (task 19) and `BRANCH_NOT_FOUND` (task 18) carry no `details`, but §9 lists `{ floor_id }` / `{ branch_id }`. The new codes in this batch follow §9: `TABLE_NOT_FOUND { table_id }`, `STATION_NOT_FOUND { station_id }`, `PROGRAM_NOT_FOUND { program_id }`, `TAX_CLASS_NOT_FOUND { tax_class_id }` and `CATEGORY_NOT_FOUND { category_id }`. With the #77 change in item 1, `FLOOR_NOT_FOUND` could now carry `{ floor_id }` too. The reviewer should decide whether to align it.
3. **Floor reference read (task 23):** `shareFloor` uses `tenant_id = $1 AND branch_id = ANY($2) AND floor_id = $3 FOR SHARE`, without `branch_id = $3`. Without it, another allowed branch's floor can't be told apart as `wrong_branch` (the plan's `[01a §6.6]` test). It is still scoped to the tenant and the caller's branches. Routes in task 32 (station of another branch → `wrong_branch`, #34) will need the same pattern.
4. **"Active route" (tasks 24, 25):** the S22 in-use checks count only routes whose `menu_items` row is active (`archived_at IS NULL`), like floors count only active tables. As a result, a station or program can be archived while an *archived* item still routes to it. Task 30 (item PATCH restore) or task 32 should make sure a restored item cannot bring back a route to an archived station or program.
5. **Possible deadlock, not covered by #86/#87:** a program PATCH whose merged row is active locks the program, then the station `FOR SHARE` (S8 order: target, then reference). A station PATCH to `slot` locks the station, then `UPDATE`s its programs. If both run at once, Postgres can abort one with `40P01`, which reaches the client as `500`. This is rare (an owner changing a station's type while restoring or renaming one of its programs). Task 34 might add a case.
6. **Station type change:** batch → slot clears `freshness_window_ms` and archives the station's active programs, writing one `batch_program` / `archive` audit row each, by id, after the station's own row. Slot → batch sets freshness to the body value or 0. `freshness_window_ms` sent while the merged type is `slot` → `400 VALIDATION_FAILED` with `issues[0].path = 'freshness_window_ms'`.
7. **`location_label`:** the spec gives no length. It is trimmed, 1–60 characters (the name rule), or null.
8. **Categories (task 26):** the body schema accepts `availability_windows` (0–4, minute multiples in 0 … 86 340 000, start ≠ end; exported as `AvailabilityWindows` for task 31), but nothing is written. The category response and audit rows carry no `availability_windows` yet; task 31 adds them (S47 audit rule). The tenant-wide `403` is task 33's; tenant-level writes already call `bumpConfigVersion` with `{ kind: 'tenant', ownerUserId: sub }`.
9. **Task 22:** both paths send the bytes of one `JSON.stringify({ data })` with `content-type: application/json; charset=utf-8`, through an untyped `FastifyReply`, so the Zod serializer is skipped on both paths. The plain body equals the gunzipped body byte for byte (tested). `Accept-Encoding` is matched with `/\bgzip\b/i`.
10. Tooling: one long inline edit command was refused by the shell parser before running. Nothing was applied, and the same edits were redone with the Edit tool.

No STOP; `.auto/DONE` not written (tasks 27–72 remain). Next task: 27.
