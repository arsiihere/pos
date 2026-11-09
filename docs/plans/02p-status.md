# 02p status board

Plan: `docs/plans/02p-plan.md` (18 tasks + 17b, batches 0–6, three lanes; owner, 2026-11-08). This board covers platform A (tasks 1–10) and the engine lane; platform B (tasks 11–13) keeps `docs/plans/02p-status-hub.md`. Spec: `docs/specs/02p_Platform_Changes_Spec_v1.0.md`, with 00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 01d v1.2.1, 03a v1.2 (all APPROVED). Branches: `module-02p-engine` (engine lane, `~/pos`), `module-02p` (platform A, `~/pos-cloud`), `module-02p-hub` (platform B, own worktree).

> **Short Hinglish summary — padhein yahan se**
>
> **Plan likh diya (2026-11-08):**
> - Task 0 mukammal hai: 03a v1.2 aur 01d v1.2.1 APPROVED.
> - Plan mein 18 tasks hain, do lanes mein: platform (tasks 1–13) aur engine (14–17, saath mein 03a ke purane gaps, task 17b).
> - Task 18 dono lanes merge hone ke baad chalega.
> - Aapki approval ka intezar hai. Approval ke baad platform lane ka prompt neeche hai.

## MORNING REPORT (2026-11-08): task 0 done; plan written; STOPPED for plan approval

**Head:** `module-02p-engine`, plan commit (see the git log). Nothing merged.

**Done:**
- Task 0: 03a v1.2 and 01d v1.2.1 APPROVED (owner, 2026-11-08), at `4bffa9e`.
- Targeted check: `docs/reviews/02p_task0_targeted_check.md`. Re-check: `docs/reviews/02p_task0_recheck.md`.
- Plan `docs/plans/02p-plan.md` and this board.

**Blocks:** none. The plan is waiting for approval.

**Next, after approval:**
1. You open platform A and platform B with the two prompts below.
2. The engine lane runs task 17b; it needs no schema.
3. When the platform lane pushes task 1, you merge `module-02p` into `module-02p-engine`.
4. The engine lane then runs tasks 14–17.

**Decisions for the owner:** none open.

## PLATFORM A REPORT (2026-11-09): batch 4 done (tasks 11–13 + AD-32), gate green, pushed — platform A complete

> **Hinglish:** Batch 4 mukammal. Platform A ke saare tasks (1–13) done. Gate green (3395 tests). AD-32 aapke kehne par badla: table archive/restore ab directory bump karta hai. Do sawal: AD-35 (chhota), AD-37. Engine lane: AD-13 (config-hook V4 import).

**Head:** `module-02p`. **Blocks:** none. **Decisions for the owner:** AD-35 (recommend accept), AD-37 (recommend accept; optional log line later).

## Task table

| # | Task | Lane | Risk | Status | Commit |
|---|---|---|---|---|---|
| 0 | 03a v1.2, 01d v1.2.1, text patches | engine | — | **done** | `73ff815`…`4bffa9e` |
| 1 | Event schemas: additive fields, `StockTransferredOut` | platform A | NORMAL | **done** (pushed) | `3db9ce1` |
| 2 | Permissions, `my_zones`, ranks, labels | platform A | NORMAL | **done** | `a4a6f73`, `a49d8cc` |
| 3 | Cloud zones, routes, stock items, `is_ready_item`, settings columns | platform A | HIGH | **done** | `3539af8`, fixes `af635a6`, `81695c9`, `0dba2ba`, `16ed188` (AD-15), `2bfa4b1` (AD-16) |
| 4 | Snapshot V4, hub apply | platform A | HIGH | **done** | `a0b85ba` |
| 5 | `StockTransferredOut` in `stock_version`, stock frame | platform A | NORMAL | **done** | `5442fd0` |
| 6 | Owner app: zones, ready item, settings | platform A | NORMAL (UI) | **done** | `0d2d7d8`, fix `3d63bfb` |
| 7 | Assignments, directory v3, `assignedOrderTaker` | platform A | HIGH | **done** | `d53c3b5`, fix `8685f0c` |
| 8 | `my_zones` CHECK expand, `zonesOf` | platform A | HIGH | **done** | `9d8caca` |
| 9 | Default grants, re-seed, settings `PATCH` | platform A | NORMAL | **done** | `1fcc535` |
| 10 | Owner app: assigned tables | platform A | NORMAL (UI) | **done** | `a838ff7`, fix `2ca9e68` |
| 11 | 00 M95 paused idle clock | platform A (batch 4; B not opened) | NORMAL | **done** | `cfb5786` |
| 12 | `X-Queued-At`, `queueable`, CORS | platform A (batch 4; B not opened) | NORMAL | **done** | `faaa2a4`, fixes `b00bb27`, `ec1b771` |
| 13 | 01d D-1, D-3 | platform A (batch 4; B not opened) | NORMAL | **done** | `0a9b418`, fixes `e48a26e`, `3a9c849` |
| 17b | 03a carry-over (open item 13: gaps 1, 2, 4, 5, 7) | engine | NORMAL | todo | |
| 14 | Q-1 reader pair, Q-2 key, label, bound | engine | NORMAL | todo (needs task 1 merged) | |
| 15 | Q-3 zone lines, filter, boot id set | engine | HIGH | todo (needs task 1 merged) | |
| 16 | Q-4 partial `ItemRemoved` | engine | NORMAL | todo (needs task 1 merged) | |
| 17 | Q-5 `StockTransferredOut` fold, Q-6 `ItemServed` | engine | HIGH | todo (needs task 1 merged) | |
| 18 | Simulator gate, full gate, README | engine | NORMAL | todo (needs all three lanes merged) | |

## AD rows

| # | Task | Reading | Options | Choice | Status |
|---|---|---|---|---|---|
| AD-1 | 1 | `StockTransferredOut.quantity` is `z.number().positive()` (plan "number > 0"). 01a v2.3 / 02b / 03a give no type; `StockAdded` v2 is `int().min(1).max(1_000_000)`, and 02b's refill is `draw × quantity` of ints | (a) keep `positive()`; (b) `int().min(1)` like `StockAdded` | (b) — fixed in `0205a24` (01a S44) | **ruled (owner, 2026-11-08)** |
| AD-2 | 2 | Files outside the brief's list, all forced by the task: `people.test.ts` (new, client half of the `WIDTH` test the brief names), `RoleEditor.test.tsx` (orders-group counts 4→9, 3→8: group grew 6→11), `docs/design/handoff/01b/urdu-todo.md` (Urdu goes to the to-do list, n-5); extra label `roles.scope_help.my_zones` (`RoleEditor.tsx` needs it to typecheck). English label wording is ours (no spec text) | (a) keep; (b) revert and re-plan | (a) | **accepted (owner, 2026-11-08)** |
| AD-3 | 2 | `ZONE_NOT_FOUND` is in `errors.ts` but not yet in the foundation §6.2 404 list (CLAUDE.md: "append them to the foundation §6.2 list"; R34: no bump). 02p task 2's file list names only `errors.ts` | (a) append it to foundation v1.11 §6.2 in a small docs commit now; (b) leave it to task 18's "spec text" | (a) — appended in `b55c7d9` | **accepted (owner, 2026-11-08)** |
| AD-4 | 3 | Restoring a table whose stored zone was archived meanwhile (incl. the Undo chip): spec silent | (a) clear `zone_id`; (b) 422 `zone_id` | (a) | **ruled (owner, 2026-11-08)**; 01a v2.3 §6.6 marker |
| AD-5 | 3 | Restoring a zone whose floor is archived: spec silent | (a) 422 `floor_id` `archived`; (b) allow | (a) | **ruled (owner, 2026-11-08)**; 01a §6.6b marker |
| AD-6 | 3 | Archiving an item / station named by an active zone list, or making a zone stock item weighed / not piece: spec silent | (a) `409 CONFIG_IN_USE` `used_by` zone; (b) V4 builder drops them | (a) | **ruled (owner, 2026-11-08)**; 01a §6.9, §6.15 markers |
| AD-7 | 3 | New `CONFIG_REFERENCE_INVALID` reasons `wrong_floor`, `not_piece`, `requires_weighing` | (a) add to 01a §9 + client texts (task 6); (b) reuse old reasons | (a) | **ruled (owner, 2026-11-08)**; 01a §9 marker |
| AD-8 | 3 | 01a #184's snapshot clause ("snapshot shows the zone `is_archived: true`") needs V4: task 3 tests the cloud half, task 4 the snapshot half (same number in two tasks) | (a) split as stated; (b) all of #184 in task 4 | (a) | **ruled (owner, 2026-11-09)** |
| AD-9 | 3 | Restoring a zone whose stored lists name an item / station archived since (AD-6 skips archived zones) | (a) drop stale entries in the same write; (b) 422; (c) allow, builder skips | (a); round 3 allowed (owner) | **ruled (owner, 2026-11-08)**; 01a §6.6b marker |
| AD-10 | 4 | Plan said `BranchConfig.settings.{…}`; 01a §5.2a says the columns are delivered like the other `branch_engine_settings` fields (top-level `engine_settings`) | (a) `engine_settings.*`; (b) new `settings` key | (a); plan tasks 4, 11 text fixed | **ruled (owner, 2026-11-08)**; 01a §4.3 marker |
| AD-11 | 4 | Archived zone's lists in V4: spec silent | (a) `[]`; (b) stored lists | (a) | **ruled (owner, 2026-11-08)** |
| AD-12 | 4 | Order of `routes[]` / `stock_items[]` (no `sort_order`) | (a) by `item_id`; (b) by item name, then id | (a) | **ruled (owner, 2026-11-08)** |
| AD-13 | 4 | Engine-owned `apps/hub/test/engine/config-hook.int.test.ts` imports `BranchConfigSnapshotSchemaV3` | (a) deprecated alias `V3 = V4` in `@pos/events` until the engine lane switches; (b) engine lane fixes; (c) keep name | (a); **the engine lane must switch its import; the alias is NOT removed on `module-02p` — task 18 removes it on the merged head** (owner, 2026-11-09) | **ruled (owner, 2026-11-08, 2026-11-09)** |
| AD-14 | 4 | Zones of an archived floor are not delivered in V4 (only active floors) | (a) accept; (b) deliver | (a) | **ruled (owner, 2026-11-08)**; 01a §4.3 marker |
| AD-15 | 3 (follow-up) | Zone lists could name an item with no `item_routes` row at the branch (not in `items[]`) | (a) zone write requires the route (422 `not_found`), §6.16 route removal refused while a zone names it (409); (b) builder filters; (c) 02b ignores | (a) — follow-up fix after task 5; every route-removing write (only §6.16 exists; §6.15 takes no routes), and the AD-9 restore drops unrouted entries (owner, 2026-11-08) | **ruled (owner, 2026-11-08)**; 01a §6.6a marker |
| AD-16 | 6 | No API returned a zone's lists (the UI used a no-op PATCH, which can revert a concurrent rename) | (a) §6.2 floors list returns `routes[]`, `stock_items[]` (3 → 5 statements); (b) new `GET` zone | (a) | **ruled (owner, 2026-11-08)**; 01a §6.2 marker |
| AD-17 | 6 | Zone archive UX: Undo chip restored only the zone, not its tables' `zone_id` | (a) confirm dialog, no Undo; (b) Undo re-zones tables; (c) reword chip | (a) | **ruled (owner, 2026-11-08)**; 01a §6.6b marker |
| AD-18 | 6 | Settings form sends the five fields before task 9's PATCH accepts them (400 / dropped on this branch) | (a) accept, transient until task 9; (b) hide until the wire has them | (a) | **ruled (owner, 2026-11-08)** |
| AD-19 | 6 | Comp chips help text promised "'Other' asks for a note" (02b ties it to the code `other`); duplicates accepted | (a) neutral help, refuse case-insensitive duplicates; (b) keep | (a) | **ruled (owner, 2026-11-08)** |
| AD-20 | 9 | `served_estimate_ms` has no range in 01a §5.2a ("nullable, until 03b") | (a) not writable by the settings PATCH yet (stays null, delivered null); (b) accept with a chosen range | (a) | **ruled (owner, 2026-11-08)** |
| AD-21 | 7 | Brief named StaffWire fields `assigned_*`; 01b §5.3 / §6.2 say `zone_ids` / `table_ids` (directory keeps `assigned_*`) | spec wins (plan rule) | spec | **ruled (controller, spec wins)**; 01b rule 7 marker |
| AD-22 | 7 | Staff version input omits `assignments` | (a) include; (b) leave out | (a) | **ruled (owner, 2026-11-08)** |
| AD-23 | 7 | PATCH semantics for `assignments`, duplicate branch | (a) per sent branch, dup → 400; (b) whole list | (a) | **ruled (owner, 2026-11-08)** |
| AD-24 | 7 | Table archived after assignment; table vs zone assignee | (a) keep rows, filter, table wins; (b) delete; (c) 409 | (a) | **ruled (owner, 2026-11-08)** |
| AD-25 | 7 | Hub join table → zone for `assignedOrderTaker` | (a) injected `zoneOfTable` reader; (b) caller passes zone; (c) directory carries it | (a) | **ruled (owner, 2026-11-08)** |
| AD-26 | 7 | Reasons not in rule 7 (unknown id, branch outside `branch_ids`, field, holder) | (a) `not_found`, `wrong_branch`, plain field, current holder; (b) indexed field | (a) | **ruled (owner, 2026-11-08)** |
| AD-27 | 7 | Statement counts: admin staff GET 6 → 7, hub directory load 10 → 11 | (a) accept +1 each; (b) fold into one statement | (a) | **ruled (owner, 2026-11-08)** |
| AD-28 | 7 | Zone archive / restore did not bump `directory_version` | (a) bump; (b) like floors | (a) | **ruled (owner, 2026-11-08)**; 01a §6.6b marker |
| AD-29 | 7 | A left person could be given assignments that block active staff | (a) ignore sent assignments, holder check active only; (b) 422 | (a) | **ruled (owner, 2026-11-08)** |
| AD-30 | 7 | `assignedOrderTaker` counted `requires_approval` as holding `take-order` | (a) `allowed` only; (b) both | (a) | **ruled (owner, 2026-11-08)** |
| AD-31 | 7 | Re-sending an already-held archived zone / table → 422 `archived` | (a) exempt held ids; (b) client filters | (a) | **ruled (owner, 2026-11-08)** |
| AD-32 | 7 | Table archive / restore does not bump `directory_version` | (a) accept; (b) bump | **(b) — reversed by the owner 2026-11-09**: table archive / restore bumps `directory_version` like zones; fix after batch 4 tasks, before the batch 4 gate | **ruled (owner, 2026-11-09)** |
| AD-33 | 8 | `zonesOf` returns sorted, de-duplicated ids (§4.2 says a union) | (a) sorted + dedup like `floorsOf`; (b) unordered | (a) | **ruled (owner, 2026-11-09)** |
| AD-34 | 8 | The hub directory holds only staff with a PIN, so a lead without a PIN adds none of their zones to `my_zones` (§3.3 says the lead's zones count); pre-existing behaviour | (a) accept (refillers' leads have PINs); (b) carry lead zones for no-PIN leads | (a) for the pilot; 01b §12.3 D-18 known limitation; field-visit check 17a | **ruled (owner, 2026-11-09)** |
| AD-35 | 12 | `X-Queued-At` readings: integer ms epoch; missing / bad header → `null` (no 400, 02b :104, :194); `started_at` = the session's `staff_sessions.started_at` | as built | as built | **accepted (owner, 2026-11-09)** |
| AD-36 | 13 | `skip_requester` vs the fallback chain; marker when the absent holder is the requester | requester filtered from every fallback level and not counted as covered, chain continues, else no-receiver (logged); no marker | as ruled | **ruled (owner, 2026-11-09)**; 01d D-3 marker |
| AD-37 | 13 | With `skip_requester`, an absent table holder who is NOT the requester, whose only reachable fallback is the requester: the step gets no row and no log line (a marker never becomes a row, AD-63) — same as the existing "absent owner, chain finds nobody" case, but more frequent now | (a) accept as the existing rule; (b) add a log line / diagnostic for this case | **(b)**: one warn line per (alert, step) with no receiver `{ alert_id, kind, step, reason: 'no_receiver' }` | **ruled (owner, 2026-11-09)**; 01d D-3 marker |

New rows get status **"proposed (not yet ruled)"**. The owner rules them in batches.

## Owner rulings (this sprint)

| Date | Ruling | Where |
|---|---|---|
| 2026-11-08 | R-1 `registerSlipReaders`; `fires_alerts` bound 2 + ≤ 2 + ≤ 1 + 01d (test 121) | 03a v1.2 |
| 2026-11-08 | R-2 slip label = the primary table's **name** (field `table_code`); 01d P-1 chip `T…` only for all-digit values | 03a v1.2, 01d v1.2.1 |
| 2026-11-08 | R-3 one boot read, step 3 = 4 + 2 + 1, from the older of two **readable** checkpoints, else seq 0 (T-6, re-check R-2) | 03a v1.2 §3.12 |
| 2026-11-08 | Q-v1.2-2 (absent-id noise on exited orders) left for the 04 spec | 03a v1.2 §12.3 |
| 2026-11-09 | AD-35 accepted; AD-37 rejected → one warn line per (alert, step) with no receiver; AD-13 alias stays on `module-02p`, task 18 removes it on the merged head | board, 01d D-3 |
| 2026-11-09 | Batch 3 review: AD-8 (a), AD-33 (a), AD-34 (a) for the pilot + known limitation; **AD-32 reversed to (b)** (table archive / restore bumps `directory_version`) | board, 01b, 01a, field visit |
| 2026-11-08 | Plan APPROVED; three lanes (platform A 1–10, platform B 11–13, engine 14–17, 17b, 18); `boot.int.test.ts` owned by platform A, engine boot tests in `boot-idset.int.test.ts` | plan |
| 2026-11-08 | AD-1: `StockTransferredOut.quantity` = `int().min(1)` (01a S44), fixed now (`0205a24`); AD-2 accepted; AD-3 accepted, `ZONE_NOT_FOUND` appended to foundation v1.11 §6.2, no bump (`b55c7d9`); the `my_zones` 500 until task 8 accepted (transient on this branch) | board, foundation §6.2 |

## Batch entries

*(one per checkpoint, newest last)*

```
## Batch N — <title> (<date>)

- **Lane / tasks:** …
- **Commits:** `<sha>` (task), …
- **Reviews:** per task; HIGH by opus. Findings and fix commits.
- **Gate:** TMPDIR=/dev/shm flock … — <files>, <tests>, <wall time>.
- **Tests closed:** …
- **AD rows (proposed):** …
- **Carried:** …
```

## Batch 1 — shared types and schemas (2026-11-08)

- **Lane / tasks:** platform A, tasks 1, 2.
- **Commits:** `3db9ce1` (task 1, pushed right away for the engine merge), `a4a6f73` (task 2), `a49d8cc` (task 2 review fix).
- **Reviews:** both by opus. Task 1: approved, no Critical / Important (minor: the fixture sweep asserts only "parses", a reject test carries the `#129` label, `quantity` type → AD-1). Task 2: approved; one Important, plan-mandated: a `my_zones` grant passes Zod and the service check but hits the old cloud CHECK (`0005_staff_roles.sql:68`) → 500 until task 8's expand migration; closes in batch 3. Fix round 1 (sonnet re-review, approved): `already_assigned` in `REASONS_01B`, `my_zones` help text names the lead.
- **Gate:** `TMPDIR=/dev/shm DATABASE_URL=…/pos_test_cloud flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` — exit 0; 362 files passed, 1 skipped; 3227 tests passed, 1 skipped, 1 todo; 8 m 44 s.
- **Tests closed:** U-5 schema part (C-1, E-1, Q-4, Q-6, Q-9, Q-5 schema), 03a #129; U-4 catalogue, scope sets, ranks, labels.
- **AD rows (proposed):** AD-1, AD-2, AD-3.
- **Carried:** the `my_zones` 500 until task 8.

## Batch 2 — 01a (2026-11-08)

- **Lane / tasks:** platform A, tasks 3, 4, 5, 6, plus the owner-ruled follow-ups AD-15 and AD-16 to task 3.
- **Commits:** task 3 `3539af8`, fixes `af635a6` (table-patch lock order), `81695c9` (AD-4–AD-6), `0dba2ba` (AD-9, lock edge; round 3 allowed by the owner), `16ed188` (AD-15), `2bfa4b1` (AD-16); task 4 `a0b85ba`; task 5 `5442fd0`; task 6 `0d2d7d8`, fix `3d63bfb`. Spec text (as-built markers, owner rulings): `e1586b7`, `8a218dd`, `401a748`, `fc59edd`, `f6f8edc`, `0668741`, `3122f19`, `4bf54ed`, `8a76a19`, and AD-20 in this checkpoint.
- **Reviews:** all by opus. Task 3: needs fixes (deadlock table PATCH × zone archive; four spec-silent rules → AD-4–AD-7; restore with stale lists → AD-9); three rounds, approved. AD-15 and AD-16: approved. Task 4: approved, no Important (NEEDS_CONTEXT first → AD-10–AD-13). Task 5: approved. Task 6: needs fixes (no-op PATCH read could revert a concurrent rename → AD-16; zone Undo did not re-zone tables → AD-17; 200-item pickers; chips → AD-19); one round, approved.
- **Gate:** `TMPDIR=/dev/shm DATABASE_URL=…/pos_test_cloud flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` — exit 0; 366 files passed, 1 skipped; 3317 tests passed, 1 skipped, 1 todo; 9 m 36 s.
- **Tests closed:** 01a #181–#186, #189–#191 (cloud), #184 snapshot clause, #187 "+1" (config-only 23 → 24, with directory 32 → 33), #188, #192, #193 (delivered with defaults), #194 first two clauses, #195 and the client parts of #181, #189–#195; U5 (every fixture V4).
- **AD rows:** AD-4–AD-7, AD-9–AD-20 ruled by the owner; AD-8 (#184 split between tasks 3 and 4) proposed.
- **Carried:** AD-13 — the engine lane must switch `apps/hub/test/engine/config-hook.int.test.ts` to `BranchConfigSnapshotSchemaV4`, then the alias goes. AD-18 — the five settings fields are not accepted by the cloud PATCH until task 9. Parked minors (no more rounds): a test for "restore resends an equal but stale list → 422"; the lock-edge test hangs instead of failing on a regression; `aStockTransferredOut` builder missing in `@pos/events/testing`; the zone editor's Archive skips the leave guard; urdu-todo header counts.

## Batch 3 — 01b (2026-11-09)

- **Lane / tasks:** platform A, tasks 7, 8, 9, 10 (8 ‖ 10 and 9 ran in parallel on disjoint files).
- **Commits:** task 7 `d53c3b5`, fix `8685f0c`; task 8 `9d8caca`; task 9 `1fcc535`; task 10 `a838ff7`, fix `2ca9e68`. Spec text: `d69dc7b` (AD-21–AD-28), `b8e1742` (AD-29–AD-32, bound row 6), and in this checkpoint the 01b §6.10 note for `served_estimate_ms` and `docs/plans/02p-release-notes.md`.
- **Reviews:** all by opus (task 10's small round by sonnet). Task 7: NEEDS_CONTEXT first (7 questions → AD-21–AD-28); review found an Important hole (a left person could hold assignments that block active staff → AD-29) plus AD-30, AD-31; one round, approved. Task 8: approved (readings AD-33, AD-34). Task 9: approved (minor: cloud does not trim chips). Task 10: approved; small round (section hidden for a left person, held items on archived floors shown).
- **Gate:** `TMPDIR=/dev/shm DATABASE_URL=…/pos_test_cloud flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` — 369 files passed, 1 skipped; 3372 tests passed, 1 skipped, 1 todo; 9 m 49 s.
- **Tests closed:** U-3 (assignments, directory v3, `assignedOrderTaker`, client part); 01a #187 "+2" (with directory 34); U-4 (`zonesOf`, `my_zones` rank and CHECK, defaults by `default_key`, settings PATCH); 01a #193 "written, range-checked".
- **Closed carries:** the `my_zones` 500 (batch 1) — closed by task 8's CHECK expand; AD-18 (settings fields before task 9) — closed by task 9.
- **AD rows:** AD-21–AD-32 ruled; AD-33, AD-34 proposed.
- **Carried / parked:** no route-level test of saving a `my_zones` grant (DB test covers the cause); 02b must intersect with `zonesOf` for `my_zones` (no match without an assignment); cloud does not trim chip labels; AD-13 alias still waits for the engine lane.

## Batch 4 — 00 and 01d (2026-11-09)

- **Lane / tasks:** platform A (platform B not opened), tasks 12 ‖ 13, then 11; plus the owner's reversed AD-32 fix.
- **Commits:** task 12 `faaa2a4`, fixes `b00bb27` (`queuedAt` required), `ec1b771` (test fixtures); task 13 `0a9b418`, fixes `e48a26e` (skip_requester in fallbacks), `3a9c849` (test types); task 11 `cfb5786`; AD-32 `1cb04bd` (table archive / restore bumps `directory_version`). Spec text: `68e3d79` (rulings 2026-11-09), `7c9f007` (01d D-3 fallbacks).
- **Reviews:** all opus (small re-reviews sonnet). Task 12: one Important (optional `queuedAt` would read `undefined` as queued) → fixed. Task 13: one Important (fallback chain could ring the requester) → owner ruling, fixed. Task 11: approved (spec decides all three implementer concerns; no real device is HTTP-only). AD-32: approved.
- **Gate:** first run failed at `@pos/hub typecheck:tests` (two test files: task 13 round-1 test types, task 12's required `started_at` in fixtures) → fixed `ec1b771`, `3a9c849`. Second run: 371 files passed, 1 skipped; 3395 tests passed, 1 skipped, 1 todo; 10 m 16 s.
- **Tests closed:** 00 #152–#156 and Review Focus 1 (task 11); 00 #157, #158 (task 12); 01d #25 as changed, D-1 (a)–(d), D-3 (U-6) (task 13); 01b AD-32 (table archive bump).
- **AD rows:** AD-35 (X-Queued-At readings) and AD-37 proposed; AD-36 ruled.
- **Carried / parked:** no zone-order-taker-level skip_requester test; after a restart `paused_since` = `hub_down_at` (spec, M95 in memory); AD-13 alias still waits for the engine lane.

## Platform A prompt (for the owner to paste into a new session)

```
You are the lead of PLATFORM A of sprint 02p (Platform Changes) of the restaurant POS (arsiihere/pos).

Setup:
- Work in the worktree ~/pos-cloud. It is on module-03a-hub3 today. Run:
  `cd ~/pos-cloud && git fetch origin && git switch -c module-02p origin/module-02p-engine`
  (the plan and the approved specs are on that branch).
- Branch module-02p. Push only with `git push origin module-02p`. Two other lanes run in parallel: the engine lane (~/pos, module-02p-engine) and platform B (module-02p-hub, tasks 11–13). Never merge, force-push, push to main, reset or rebase: merges are the owner's.
- Cloud tests use DATABASE_URL=postgres://pos:pos@127.0.0.1:5433/pos_test_cloud. The engine lane uses …/pos_test and platform B …/pos_test_hub; never touch them.
  If pos_test_cloud does not exist, create it once:
  `docker exec pos-pg-test psql -U pos -c 'CREATE DATABASE pos_test_cloud'`.
  The test container `pos-pg-test` runs with fsync off. Never stop, restart or `compose down` it.
- The full gate is shared with the other two lanes. Run it only as:
  `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` (≈ 9 min).
  Never run `pnpm test:perf`.

Read first, in order:
1. CLAUDE.md (incl. "Test environment")
2. docs/specs/README.md
3. docs/specs/02p_Platform_Changes_Spec_v1.0.md
4. docs/plans/02p-plan.md: your tasks are 1–10 (batches 1–3); read its "File ownership" paragraph
5. docs/plans/02p-status.md
6. the bumped spec each task cites (00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 01d v1.2.1, 03a v1.2 §4.2 for the event fields)

Build:
- superpowers:subagent-driven-development + superpowers:test-driven-development.
- One fresh implementer and one fresh reviewer per task; an opus reviewer for HIGH tasks (3, 4, 7, 8).
- One task per commit, citing the row and §, e.g. `feat(01b): my_zones scope [01b v1.7 B-3; 02p §11 #8]`.
- Full gate after each batch. Then write the batch entry in docs/plans/02p-status.md, commit it alone, and push.
- **Push task 1 as soon as it is green and tell the owner.** The owner merges it into module-02p-engine so the engine lane can start tasks 14–17.
- **Tell the owner when task 4 is pushed.** The owner merges module-02p into module-02p-hub so platform B can start task 11.
- Edit only the files of your tasks (plan "File ownership"). Under apps/hub/test/engine/ you own exactly boot.int.test.ts and stock-audiences.int.test.ts (task 5). The engine lane owns packages/engine, apps/hub/src/engine-host and every other file under apps/hub/test/engine/. Platform B owns the session, command-route, CORS and alerts files of tasks 11–13. Never touch theirs.

Stop rules:
1. Spec and code disagree, or two specs disagree → STOP, ask with options and your recommendation.
2. A test needs a timeout raised or a bound changed → STOP.
3. You would edit a file outside the task (or outside 02p §10 Acceptance) → STOP.
4. A review fix round would go past 2 → STOP.
5. Any new behaviour not in a spec → STOP (spec-first).
Record readings you make without stopping as AD-n rows in docs/plans/02p-status.md, status "proposed (not yet ruled)". Never accept your own readings.

Reports: short. Commits done, what blocks, decisions for the owner as a numbered list, one line each, with your recommendation. The owner reads Hinglish; keep it plain.

Start with batch 1 (tasks 1, 2).
```

## Platform B prompt (for the owner to paste into a new session)

```
You are the lead of PLATFORM B of sprint 02p (Platform Changes) of the restaurant POS (arsiihere/pos).

Setup:
- Use your own worktree (suggested: `git -C ~/pos worktree add ~/pos-hub -b module-02p-hub origin/module-02p-engine`; the owner may pick another path). The plan and the approved specs are on that branch.
- Branch module-02p-hub. Push only with `git push origin module-02p-hub`. Never merge, force-push, push to main, reset or rebase: merges are the owner's. Two other lanes run in parallel: the engine lane (~/pos, module-02p-engine) and platform A (~/pos-cloud, module-02p, tasks 1–10).
- Tests that need Postgres use DATABASE_URL=postgres://pos:pos@127.0.0.1:5433/pos_test_hub. If it does not exist, create it once: `docker exec pos-pg-test psql -U pos -c 'CREATE DATABASE pos_test_hub'`. Never touch pos_test or pos_test_cloud. Never stop, restart or `compose down` pos-pg-test (fsync off).
- The full gate is shared with the other two lanes. Run it only as:
  `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` (≈ 9 min). Never run `pnpm test:perf`.

Read first, in order:
1. CLAUDE.md (incl. "Test environment")
2. docs/specs/README.md
3. docs/specs/02p_Platform_Changes_Spec_v1.0.md
4. docs/plans/02p-plan.md: your tasks are 11, 12, 13 (batch 4); read its "File ownership" paragraph
5. docs/specs/00_Hub_Platform_Access_Spec_v1.8.md (M95, tests 152–158) and docs/specs/01d_Notifications_Requests_Spec_v1.2.1.md (D-1, D-3, test 25)

Build:
- superpowers:subagent-driven-development + superpowers:test-driven-development. One fresh implementer and one fresh reviewer (opus) per task.
- Order: 12, 13, then 11. Task 11 reads BranchConfig.settings.queue_auto_send_max_ms, which platform A's task 4 adds: start 11 only after the owner has merged module-02p (with task 4) into module-02p-hub.
- One task per commit, citing the row and §, e.g. `feat(00): X-Queued-At and queueable commands [00 v1.8 H-1; 02p §11 #12]`.
- Full gate after the batch. Then write the batch entry in docs/plans/02p-status-hub.md (your own board; AD rows are numbered AD-H1, AD-H2, …), commit it alone, and push.
- Edit only the files of your tasks. Never touch packages/*, apps/cloud, apps/client, migrations, hub engine-host or apps/hub/test/engine/.

Stop rules:
1. Spec and code disagree, or two specs disagree → STOP, ask with options and your recommendation.
2. A test needs a timeout raised or a bound changed → STOP.
3. You would edit a file outside the task (or outside 02p §10 Acceptance) → STOP.
4. A review fix round would go past 2 → STOP.
5. Any new behaviour not in a spec → STOP (spec-first).
Record readings you make without stopping as AD-H rows in docs/plans/02p-status-hub.md, status "proposed (not yet ruled)". Never accept your own readings.

Reports: short. Commits done, what blocks, decisions for the owner as a numbered list, one line each, with your recommendation. The owner reads Hinglish; keep it plain.

Start with task 12.
```
