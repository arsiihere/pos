# 02p status board

Plan: `docs/plans/02p-plan.md` (18 tasks + 17b, batches 0–6, three lanes; owner, 2026-11-08). This board covers platform A (tasks 1–10) and the engine lane; platform B (tasks 11–13) keeps `docs/plans/02p-status-hub.md`. Spec: `docs/specs/02p_Platform_Changes_Spec_v1.0.md`, with 00 v1.8, 01a v2.3, 01b v1.7, 01c v1.1.2, 01d v1.2.1, 03a v1.2 (all APPROVED). Branches: `module-02p-engine` (engine lane, `~/pos`), `module-02p` (platform A, `~/pos-cloud`), `module-02p-hub` (platform B, own worktree).

> **Short Hinglish summary — padhein yahan se**
>
> **2026-11-09 (din):** Aapke faisle lag gaye.
> - Pehle spec badli: §3.3 served time, §3.8 placed_by fallback, §3.12 empty orders.
> - Phir kaam hua:
>   - 17c ka doosra perf block;
>   - AD-E2 ka fix;
>   - task 15 (zone lines, khaali orders, boot id set).
> - Gate green: 3362 tests, 523 s. Sab push.
> - Engine lane ke tasks 14–17, 17b aur 17c mukammal hain. Task 18 baaqi merges ke baad.
> - Aapke liye: E-4 (khaali order mein baad mein pakne wali cheez) aur AD-E19–E23.

## MORNING REPORT (2026-11-09, day): rulings applied; 15, 17c, AD-E2 done; engine lane done except 18; STOPPED

**Done:**
1. **Spec first** (`bf876a1`): E-3 (§3.3 `last_served_at` = min(served_at, recorded_at), plus the `state.ts:111` comment); AD-E2 (§3.8: a holder not in the directory → `placed_by`); AD-E18 (§3.3 / §3.12: empty orders in the id set, one boot read); Q-v1.2-3 (a note for 04); 02a §12.3 note (each slip reader = one statement).
2. **17c fix** (`c847a7b`): a second measured block at the first slip due time + 60 s (≈ 10 slips), with the same 20 ms bound; the old row is unchanged. The new asserts run outside the timed part. It is proven only by `test:perf` in task 18.
3. **AD-E2 fix** (`f02a981`): a holder not in the directory now falls back to `placed_by`; test 120 has two new cases; the bound is unchanged.
4. **Task 15**:
   - `149c188`: only the three step-3 checks in `boot.int.test.ts` (E-2).
   - `90e4282`: zone lines, empty orders, the absent-id filter and the boot id set.
   - Fix `04d4662`: a replay-fed id-set case.
   - Tests #124, #125 (all three checkpoint cases plus the ready-items-only order), #130 (4 + 2 + 1, `events_branch_stream`).
5. **Every task** has a fresh opus review, then a scoped re-review of its fix.
6. **Gate** at `04d4662`: green, 368 files, 3362 tests, 523 s.

**Blocks:** none in the engine lane. Task 18 waits for the platform A and B merges.

**Decisions for the owner:**
1. **E-4:** an `OrderLinesAdded` on an order of ready items only. As built (and as §3.3 says), the fold throws and the whole command rolls back; if such an event were ever in the log, boot would stop. Nothing sends it yet (02b is not built). Recommend **(b)**: 03a creates the engine order on the first `OrderLinesAdded` for an order in the id set, spec first. With (a), that order's real absent ids would stay silenced for good.
2. **AD-E19–AD-E22:** readings from task 15, all consistent per the review. Recommend accepting them.
3. **AD-E23:** a note for the owner of `test-hub.ts`: reset `untrackedLineIds` in `createTestHub`. Recommend (b), later.

<details><summary>Night report (2026-11-09)</summary>

> **Short Hinglish summary — padhein yahan se**
>
> **Raat ka kaam (2026-11-09, engine lane, unattended):**
> - Batch 5a aur 5b chal gaye. Gate dono baar green (aakhri: 3348 tests, 519 s). Sab push ho gaya.
> - Mukammal: 17b (03a ke purane gaps), 14 (slip ka receiver aur table ka naam), 16 (partial remove), 17 (zone ko stock transfer, served_at).
> - **Do kaam ruke hue hain, aapke faisle chahiye:**
>   - 15: `boot.int.test.ts` platform A ki file hai (E-2).
>   - 17c: perf test ka waqt (E-1).
> - Ek spec text ka sawal: E-3. Aur 18 AD-E rows "proposed" hain; aap batch mein rule karein.
> - Task 18 dono baaqi merges ke baad.

### MORNING REPORT (2026-11-09, night): batches 5a and 5b run; 15 and 17c blocked; STOPPED

**Head:** `module-02p-engine` (checkpoint commit). Code head `337d635`. Nothing merged by me.

**Done (each reviewed by a fresh opus reviewer):**
1. 17b: `4574240`, fix `ff02a82`.
2. 14: `34ad0ba`. This includes the AD-13 V4 import switch in `config-hook.int.test.ts`; platform A can now remove the `BranchConfigSnapshotSchemaV3` alias.
3. 16: `15f639f`.
4. 17: `25b88c9`, fix `337d635`.

**Gates:** green twice, at `ff02a82` (3325 tests) and `337d635` (3348 tests).

**Blocked:**
- **Task 15:** decision **E-2**. Its one extra boot query breaks the step-3 count in the platform-A-owned `boot.int.test.ts`. The tree is clean; the design is ready in the task-15 report.
- **Task 17c:** decision **E-1**. No slip is due at the perf test's measured instant. The assert runs only under `test:perf`, so the normal gate is fine.

**Decisions for the owner:**
1. **E-1 (17c):** add a second perf block, measured at the first slip due time + 60 s, with the same 20 ms bound, and keep the existing row at `peak.at`. Recommend **(b)**.
2. **E-2 (15):** allow task 15 to edit the three step-3 asserts in `boot.int.test.ts` in its own commit (4 + 2 → 4 + 2 + 1, which R-3 already approved). Recommend **(b)**.
3. **E-3 (17):** as-built text patch to 03a v1.2 §3.3: `last_served_at` = `min(served_at, recorded_at)`, plus the `state.ts:111` comment. Recommend **(a)**.
4. **AD-E1–AD-E18:** readings from tasks 14–17, all "proposed". Each reviewer found them consistent with the spec, except AD-E11 (= E-3). AD-E6 is a note for 02a: each real reader must be exactly one statement. Recommend accepting AD-E1–E10 and E12–E18 as listed.

**Next:**
- After E-2: task 15, then a gate.
- After E-1: the 17c fix.
- Task 18 after the platform A and B merges.

</details>

<details><summary>Earlier report (2026-11-08)</summary>

> **Short Hinglish summary — padhein yahan se**
>
> **Plan likh diya (2026-11-08):**
> - Task 0 mukammal hai: 03a v1.2 aur 01d v1.2.1 APPROVED.
> - Plan mein 18 tasks hain, do lanes mein: platform (tasks 1–13) aur engine (14–17, saath mein 03a ke purane gaps, task 17b).
> - Task 18 dono lanes merge hone ke baad chalega.
> - Aapki approval ka intezar hai. Approval ke baad platform lane ka prompt neeche hai.

### MORNING REPORT (2026-11-08): task 0 done; plan written; STOPPED for plan approval

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

</details>

## PLATFORM A REPORT (2026-11-09): platform A DONE — tasks 1–13, all rulings applied, gate green, pushed

> **Hinglish:** Platform A lane mukammal. Tasks 1–13 + owner follow-ups (AD-15, AD-16, AD-32, AD-37) done. Aakhri gate green (3398 tests). V3 alias task 18 mein hatega (AD-13). Koi faisla baaki nahi.

**Head:** `module-02p`. **Blocks:** none. **Decisions for the owner:** none open. **For task 18 (engine lane, merged head):** remove the `BranchConfigSnapshotSchemaV3` alias after `config-hook.int.test.ts` imports V4 (AD-13).

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
| 13 | 01d D-1, D-3 | platform A (batch 4; B not opened) | NORMAL | **done** | `0a9b418`, fixes `e48a26e`, `3a9c849`, `32b0c16` + `614006b` (AD-37) |
| 17b | 03a carry-over (open item 13: gaps 1, 2, 4 EXPLAIN, 5, 7) | engine | NORMAL | **done** | `4574240`, fix `ff02a82` |
| 17c | Gap 4 timing: slip raise path in the peak perf run (perf file only) | engine | NORMAL | **done** (proven at `test:perf`, task 18) | `e261f25`, fix `c847a7b` |
| 14 | Q-1 reader pair, Q-2 key, label, bound | engine | NORMAL | **done** | `34ad0ba`, AD-E2 fix `f02a981` |
| 15b | E-4: the first `OrderLinesAdded` creates the engine order (`order_header`); safety net | engine | HIGH | **spec written; waits for the owner's review** | |
| 15 | Q-3 zone lines, filter, boot id set | engine | HIGH | **done** | `149c188`, `90e4282`, fix `04d4662` |
| 16 | Q-4 partial `ItemRemoved` | engine | NORMAL | **done** | `15f639f` |
| 17 | Q-5 `StockTransferredOut` fold, Q-6 `ItemServed` | engine | HIGH | **done** | `25b88c9`, fix `337d635` |
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
| AD-E1 | 14 | The two slip readers run before the per-slip skip checks, because the receiver depends on the holder; with no `slip_warning` kind registered they are not called | (a) as built; (b) run after the checks | (a) | **accepted as built (owner, 2026-11-09)** |
| AD-E2 | 14 | A holder returned by `holdersOfOrders` but not in the hub directory takes the `receiver_not_in_directory` skip, not the `placed_by` fallback (§3.8: the fallback is only for "no holder returned") | (a) skip; (b) fall back to `placed_by` | (a) | **rejected → (b) (owner, 2026-11-09):** a holder not in the directory falls back to `placed_by`; skip only if `placed_by` is missing too. Spec §3.8 patched; fix in task 14 |
| AD-E3 | 14 | A slip's stored `display` now has `table_code: null` written explicitly (it was absent); frames are unchanged (`ws-frames.ts:294` maps absent to null) | (a) explicit null; (b) omit | (a) | **accepted as built (owner, 2026-11-09)** |
| AD-E4 | 14 | Test #123 placed in `kinds.int.test.ts` (it has the answer helpers); the brief named no file | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E5 | 14 | #122 "after a move": the next raise comes through the day-close carry (#113 pattern); an already raised alert keeps its old label (R-2 accepts a frozen label) | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E6 | 14 | The fake readers each make one statement; 02a's real `holdersOfOrders` / `currentTableOf` must each be exactly **one** statement or test 121's bound breaks when 02a lands | note for 02a | — | **accepted as a note (owner, 2026-11-09); copied into 02a v1.1.1 §12.3** |
| AD-E7 | 14 | 03a v1.2 §3.2 says "tests that build `dine_in` keys use a seating id"; only `slip.test.ts` and the new tests were changed. Other files still build `dine_in:T…` keys (27 in `fires-alerts-tick.int.test.ts`, 8 in `kinds.int.test.ts`, 14 in `release.test.ts`). Behaviour is unaffected (the engine keys on `table_key` as sent) | (a) read §3.2 as the slip tests and new tests only; (b) a mechanical rename later | (a) | **accepted as built (owner, 2026-11-09)** |
| AD-E8 | 16 | A partial `ItemRemoved` whose share is not a whole number reuses `InvalidEvent('void_share_not_integer')`, as `ItemVoided` does (G4-3 #2, AD-8) | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E9 | 16 | A partial `ItemRemoved` has no stage limit beyond the open-line check; on a started line the release is capped at `reserved` (0 after a consume). Which stages allow a remove is 02b's command rule | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E10 | 16 | Built before 02p, not changed: `stockEffects` finds the line with `namedLine` (no `isOpen` check), so a partial remove or void on an ended line that still holds a reservation releases a share while the fold leaves its units alone. Live and replay still agree | (a) leave; (b) add `isOpen` (behaviour change, spec first) | (a) | **accepted (a) (owner, 2026-11-09); note for 04 in 03a v1.2 Q-v1.2-3** |
| AD-E11 | 17 | **Q-6 "served time" = the order's `last_served_at`** (the engine keeps no served time per line). §3.3 and `state.ts:111` still say `last_served_at` = the serve's `recorded_at`: **decision E-3** | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E12 | 17 | A `StockTransferredOut` for a stock item the hub has never seen writes no stock entry (on_hand stays 0) and logs one breach | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E13 | 17 | A transfer that takes `on_hand` below `reserved` but not below 0 is not a breach (Q-5 names only the clamp at 0; 02b refuses an over-transfer with `409 STOCK_INSUFFICIENT`) | (a) as built; (b) breach like `StockSet` | (a) | **accepted as built (owner, 2026-11-09)** |
| AD-E14 | 17 | `book()` (the array form of `stockEffects`) books a transfer like the fold does (review m1, `337d635`) | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E15 | 17 | The removal step that runs before every listed event still runs before a zone serve; `foldItemServed` itself returns `state` for `source: 'zone'` | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E16 | 17 | `stockEffects(ItemServed)` does not check `source: 'zone'`; zone ids are never engine lines, so nothing is drafted (only a writer bug differs) | (a) as built; (b) return none for `'zone'` | (a) | **accepted as built (owner, 2026-11-09)** |
| AD-E17 | 15 (blocked) | Test #125's control for `ItemServed`: `{ source: 'zone' }` is skipped by its shape whatever the id, so the control uses `ItemRemoved` / `ItemVoided` on an unknown id plus `ItemServed { source: 'tap' }` on an unknown id | — | proposed for task 15 | **accepted as built (owner, 2026-11-09)** |
| AD-E18 | 15 (blocked) | Ready items on an empty order: an `OrderPlaced` with no engine lines creates no engine order, so a later `ItemAdded` / `ItemServed` of a ready item on it still logs `absent id` (the Q-3 filter does not cover it) | (a) keep logging, flag for 02b; (b) widen the filter (spec first) | (a) | **rejected → (b) (owner, 2026-11-09):** the id set also holds the order ids of empty `OrderPlaced`; one boot read (`IN ('ItemAdded','OrderPlaced')`). Spec §3.3 / §3.12 patched; built in task 15 |
| AD-E19 | 15 | The ready-items-only rule finds the order from the payload `order_id`, else `stream_id` (the existing convention; `checkStream` makes them equal) | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E20 | 15 | Step 2 now parses the second kept checkpoint (0 extra statements) only to count it as readable; a torn second row is not logged, so step 2's log lines stay as they were | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E21 | 15 | The two new early returns (zone `ItemAdded`, empty `OrderPlaced`) come after `checkStream`, so a stream mismatch is still flagged as a writer bug | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E22 | 15 | New engine-lane test helper `apps/hub/test/engine/q3-lines.ts` (the brief did not list it; the engine lane owns this folder) | — | as built | **accepted as built (owner, 2026-11-09)** |
| AD-E23 | 15 | Note for the owner of `apps/hub/test/helpers/test-hub.ts` (not the engine lane): `createTestHub` does not reset `hostFlags.untrackedLineIds`, so ids can leak between test hubs in one file. Production is unaffected; the engine tests reset the set by hand | (a) leave; (b) the helper's owner adds the reset | (b), later | **(b) (owner, 2026-11-09): task 18 adds the reset to `createTestHub` on the merged head** |

New rows get status **"proposed (not yet ruled)"**. The owner rules them in batches.

## Owner rulings (this sprint)

| Date | Ruling | Where |
|---|---|---|
| 2026-11-08 | R-1 `registerSlipReaders`; `fires_alerts` bound 2 + ≤ 2 + ≤ 1 + 01d (test 121) | 03a v1.2 |
| 2026-11-08 | R-2 slip label = the primary table's **name** (field `table_code`); 01d P-1 chip `T…` only for all-digit values | 03a v1.2, 01d v1.2.1 |
| 2026-11-08 | R-3 one boot read, step 3 = 4 + 2 + 1, from the older of two **readable** checkpoints, else seq 0 (T-6, re-check R-2) | 03a v1.2 §3.12 |
| 2026-11-08 | Q-v1.2-2 (absent-id noise on exited orders) left for the 04 spec | 03a v1.2 §12.3 |
| 2026-11-09 | E-1 (b): a second measured block at the first slip due time + 60 s, same 20 ms bound; old row unchanged | task 17c |
| 2026-11-09 | E-2 (b): task 15 edits only the three step-3 count checks in `boot.int.test.ts` (4 + 2 → 4 + 2 + 1), in its own commit | task 15 |
| 2026-11-09 | E-3 (a): text patch to 03a v1.2 §3.3 and `state.ts:111`, marker "Changed by Q-6"; no version bump | 03a v1.2 |
| 2026-11-09 | E-4 → (b), a pilot blocker: new task 15b, spec first, stop for review before code; AD-E19–E22 accepted; AD-E23 (b) in task 18 | 03a v1.2 §3.3, task 15b |
| 2026-11-09 | AD-E2 → (b), AD-E18 → (b), AD-E6 note, AD-E10 (a), the other AD-E rows accepted | AD table |
| 2026-11-08 | Gap 4 timing → task 17c, option (b): `placed_by` and staff seeded in `fires-alerts-tick.perf.test.ts` only; no simulator change, no pinned hash moves | plan task 17c |
| 2026-11-08 | Plan APPROVED; three lanes (platform A 1–10, platform B 11–13, engine 14–17, 17b, 18); `boot.int.test.ts` owned by platform A, engine boot tests in `boot-idset.int.test.ts` | plan |
| 2026-11-08 | AD-1: `StockTransferredOut.quantity` = `int().min(1)` (01a S44), fixed now (`0205a24`); AD-2 accepted; AD-3 accepted, `ZONE_NOT_FOUND` appended to foundation v1.11 §6.2, no bump (`b55c7d9`); the `my_zones` 500 until task 8 accepted (transient on this branch) | board, foundation §6.2 |
| 2026-11-09 | AD-35 accepted; AD-37 rejected → one warn line per (alert, step) with no receiver; AD-13 alias stays on `module-02p`, task 18 removes it on the merged head | board, 01d D-3 |
| 2026-11-09 | Batch 3 review: AD-8 (a), AD-33 (a), AD-34 (a) for the pilot + known limitation; **AD-32 reversed to (b)** (table archive / restore bumps `directory_version`) | board, 01b, 01a, field visit |

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

## Batch 4 follow-up — owner rulings 2026-11-09 (AD-35, AD-37, AD-13)

- **Commits:** `fc6db00` (01d D-3 marker, board), `32b0c16` (one warn line `{ alert_id, kind, step, reason: 'no_receiver' }` per (alert, step) with no receiver, after commit), `614006b` (real-raise test: caller is the only candidate → one warn line, no recipient row).
- **Review:** opus — code correct (`routes.length === 0` is the no-receiver test; no repeat: hooks run only after a writer commit, re-checks are StepSkipped); the owner-named real-raise test was missing → added, checked.
- **Gate:** 371 files passed, 1 skipped; 3398 tests passed, 1 skipped, 1 todo; 10 m 43 s.
- **AD-13:** the `BranchConfigSnapshotSchemaV3` alias stays on `module-02p`; **task 18 removes it on the merged head** after the engine lane's import switch.
- **Platform A lane: done.** Open owner items: none.

## Engine lane decisions for the owner (unattended run, 2026-11-09)

| # | Task | What blocks | Options | Recommendation |
|---|---|---|---|---|
| E-1 | 17c | No slip is due at the perf test's measured instant (`peak.at`), so the new "slips > 0" assert fails under `test:perf` and the slip path is still not timed. The reviewer rebuilt the seed-7 peak: 0 slips at `peak.at`, the first at + 127.6 s, ≈ 10 at + 60 s after that. The `receiver_not_in_directory` check also cannot fail (no logger in the perf hub). | (a) Measure the with-work samples at `nextAlertDueAt(peak.state) + 60 000` (≈ 10 slips, overloads unchanged), keep the idle test at `peak.at`, assert `hostFlags.skipped.size === 0` outside the timed part, and fix the comment. This moves the instant of an existing §7.1 row. (b) Keep the existing row at `peak.at` and add a second measured block at the later instant ("with slips"), same 20 ms bound. (c) Drop the slip assert and leave gap 4 timing for task 28. | **(b)**: the existing number stays comparable with the 03a v1.0.1 A/B, and the slip path gets its own number. |
| E-2 | 15 | 03a v1.2 R-3 adds one boot statement (step 3 = 4 + 2 + 1). The platform-A-owned `apps/hub/test/engine/boot.int.test.ts` pins step 3 = 4 + 2. At `:393`, `toHaveLength(6)` becomes 7. At `:397–398`, the `version` filter (`method !== 'iterate'`) gets 3, not 2. At `:405–409`, the plan-text match fails for the new read, whose plan ends `… AND seq>?)`. The probe was reverted; the tree is clean. | (a) Platform A edits `boot.int.test.ts` (title 4 + 2 + 1, `:393` → 7, `:397` filter matches only the two `stock_version` reads, e.g. by `ORDER BY seq DESC LIMIT 1`), then the engine lane builds task 15. (b) One-time ownership exception: task 15 makes exactly these test edits in `boot.int.test.ts`, in its own commit. | **(b)**: the edit follows a rule you already approved (R-3) and lands in the same task as the code. Platform A has no other change pending in that file. |
| E-3 | 17 | 03a v1.2 Q-6 says `foldItemServed` uses `min(served_at, recorded_at)`. §3.3 (~:391 "recorded_at of the ItemServed…", ~:438 "`last_served_at` is set from that event's `recorded_at`") and `state.ts:111` were not amended. As built, `last_served_at` = `min(served_at ?? recorded_at, recorded_at)`. The exit predicate (`lifecycle.ts:65`) and `slip.ts:150` now count from the earlier time, which is Q-6's intent. Old logs fold the same, so D62 holds. | (a) A text patch to 03a v1.2 §3.3 (both lines → "min(served_at, recorded_at)") and the `state.ts:111` comment, as an as-built note; (b) a spec bump to 03a v1.2.1 | **(a)**: no rule change; the code follows Q-6. |
| E-4 | 15 / 02b | Found while writing AD-E18: 03a §3.3 says an `OrderLinesAdded` on an order not in the engine **throws**. An order of ready items only has no engine order (Q-3), so if 02b later adds a cooked item to it with `OrderLinesAdded`, the fold throws a plain `Error` (`apply-event.ts:359–366`; not an `InvalidEvent`, so it is rethrown in strict and non-strict mode alike). Live, the **whole command rolls back** (nothing is appended, no diagnostic). If such an event were ever in the log, boot step 3 would stop. No hub code sends `OrderLinesAdded` today (02b is not built). Task 15 review: under (a), the order id stays in the AD-E18 id set (the boot read re-adds it from the first empty `OrderPlaced`), and the order check runs first, so that order's real absent ids would be silenced for good. | (a) 02b sends the first cooked line as a new `OrderPlaced` **and** the host drops the order id from the set on a non-empty `OrderPlaced` (02b spec note + a small 03a rule); (b) 03a creates the engine order on the first `OrderLinesAdded` for an order in the id set (03a spec change, then code) | **(b)**: 03a's own fold handles it, and the id set stays correct with no extra rule. It needs a spec change first. No code is changed until you rule. | **Ruled (owner, 2026-11-09): (b), task 15b.**

## Batch 5a — 03a carry-over, engine lane (2026-11-09)

- **Tasks:** 17b (gaps 1, 2, 4 EXPLAIN, 5, 7), 17c (gap 4 timing, perf file only).
- **Commits:** `4574240` (17b, 8 tests), `ff02a82` (17b review minors), `e261f25` (17c).
- **Reviews:**
  - 17b: opus, spec ✅ quality ✅, 4 Minor, all fixed in `ff02a82`.
  - 17c: opus, **spec ❌**. C1: no slip is due at the measured instant `peak.at`. The reviewer rebuilt the seed-7 peak state outside the repo: 0 slips at `peak.at`, the first slip at `peak.at` + 127.6 s, ≈ 10 at + 60 s after that. So the new "slips > 0" assert will fail under `test:perf`, and the slip path is still not timed. I1: the `receiver_not_in_directory` check cannot fail (the tick has no logger in the perf hub). I2: the header comment is wrong. M1, M2 minor. **Parked as decision E-1** (it moves the measured instant). It runs only under `test:perf`, so the normal gate is not affected.
- **Gate:** `TMPDIR=/dev/shm flock … "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` at `ff02a82`: green. 366 files passed (1 skipped), 3325 tests passed (1 skipped, 1 todo), 540 s.
- **Tests closed:** 03a open item 13, gaps 1, 2, 4 (EXPLAIN), 5, 7. Gap 4's timing is open (E-1).
- **AD rows (proposed):** none. Engine-lane AD rows will be numbered **AD-E1, AD-E2 …**, because platform A uses AD-1 upward.
- **Carried:** AD-13 (owner-ruled): the engine lane switches the `BranchConfigSnapshotSchemaV3` import in `config-hook.int.test.ts` to V4; done in task 14.

## Batch 5b — 03a v1.2 engine rows (2026-11-09)

- **Tasks:** 14, 16, 17 done; 15 **blocked** (E-2).
- **Commits:** `34ad0ba` (14), `15f639f` (16), `25b88c9` (17), `337d635` (17 review fix: `book()` books `StockTransferredOut`; `served_at` checks).
- **Reviews (fresh opus each):**
  - 14: spec ✅ quality ✅, 5 Minor (optional, not applied).
  - 16: spec ✅ quality ✅, 3 Minor (optional; Minor 3 → AD-E10).
  - 17 (HIGH): spec ✅ quality ✅, 5 Minor. m1 and m5 fixed, re-review clean; m2–m4 left (m3 goes with E-3).
- **Gate:** at `337d635`: green. 367 files passed (1 skipped), 3348 tests passed (1 skipped, 1 todo), 519 s.
- **Tests closed:** 03a #94 (updated), #120, #121, #122, #123, #126, #127, #128; 01a #194 "boot fold counts it" (in the new `apps/hub/test/engine/boot-idset.int.test.ts`). Open: #124, #125, #130 (task 15).
- **AD rows (proposed):** AD-E1–AD-E18 (table above).
- **Statement bound (R-1):** `fires_alerts` with work = 2 + 1 + 1 + 1 + 6 = 11 for 1 and for 3 tables; takeaway only = 9; idle 0 (test 121).

## Batch 5c — owner rulings 2026-11-09, task 15, fixes (2026-11-09)

- **Commits:** `bf876a1` (spec: E-3, AD-E2, AD-E18, Q-v1.2-3, 02a note), `c847a7b` (17c, E-1), `f02a981` (14, AD-E2), `149c188` (15, `boot.int.test.ts` step-3 checks only, E-2), `90e4282` (15), `04d4662` (15 review fix).
- **Reviews:**
  - 17c fix: re-review ✅.
  - AD-E2 fix: re-review ✅.
  - 15 (HIGH): opus, spec ✅ quality ✅, 3 Minor. Minor 1 (replay-fed id set) and Minor 3 fixed, re-review ✅; Minor 2 → AD-E23.
- **Gate:** at `04d4662`: green. 368 files passed (1 skipped), 3362 tests passed (1 skipped, 1 todo), 523 s.
- **Tests closed:** 03a #124, #125, #130; #120 with the AD-E2 cases.
- **AD rows (proposed):** AD-E19–AD-E23.
- **Open:** E-4 (owner).

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
