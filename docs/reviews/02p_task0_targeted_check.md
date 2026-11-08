# 02p task 0 — targeted check

| | |
|---|---|
| What | 02p §11 task 0: 03a v1.2 (v1.0.1 as built + v1.1 Q-1, Q-2 + 02b Q-3–Q-6, Q-8, Q-9, E-1; owner rulings R-1–R-3), 01d v1.2.1 (v1.2 + v1.1.2 D-1, D-2 + P-1), text-only status / path / export patches (00 v1.8, 01a v2.3, 01b v1.7, 01d v1.2, 02a v1.1.1, 03a v1.1, README) |
| Commits | `73ff815`, `fde1218` (branch `module-02p-engine`) |
| Date | 2026-11-08 |
| Kind | Targeted check (not a full G4). The owner rulings R-1–R-3 are not re-argued, only checked for wording and consistency |

## Verdict: **NOT YET**

Two MAJOR findings. Both are text-only, but each leaves a current-rule sentence in 03a v1.2 that contradicts a row the draft says it carries. Fix T-1 and T-2, plus the MINOR rows, then re-check only the diff. Things that do hold:

- Every v1.1 row and every 02b Q/E row is present with a marker.
- Nothing from v1.0.1 is lost.
- Tests 120–130 do not collide with any existing 03a test number.
- The R-1 bound is the same in §6.2a, §10.5 and §12.2.
- Boot step 3 = 4 + 2 + 1 is the same in §3.12, §10.5, §12.2 and test 130.
- The R-3 sequence does show the latest checkpoint missing Z1 and H1.
- The R-3 SQL fits the as-built code: `events.payload` JSON, index `events_branch_stream` in `0007_engine.sql:26`, `ItemAdded.line_kind` in `ItemAdded.v1.ts`, and step 2's `LIMIT 2` checkpoint read in `replay.ts:178-183`.
- Every U-7 and U-8 clause of 02p maps to a test from 120 to 130.
- The 01b `zonesOf` line matches B-3 and 02p U-4. Its "leaver → empty" comes from U-4.
- The 02a paths and reader pair are right, and the README rows are well formed.

## Findings

### T-1 — MAJOR — Q-8 not applied where 02b points; a second "remake frees" sentence stays
- **Where:** `03a_Timing_Engine_Spec_v1.2.md:673` (§3.8a `ReturnToKitchen` bullet) and `:889` (§4.3 To 04, "Returned lines").
- **Problem:** 02b row Q-8 targets "03a :500". That is the §3.8a bullet in v1.1 (`03a_Timing_Engine_Spec_v1.1.md:500`, "the served line stays billed on `fix` and is freed by 04 on `remake`"). v1.2 changed §3.1 #11 (:209), but §3.8a :673 still says "is freed by 04 on `remake`". §4.3 To 04 (:889) also still says 04 reads `ItemReturned` for "the served line's bill effect (free in the pilot, wastage …)". Both contradict 02b O20: a remake frees nothing by itself.
- **Fix:**
  - At :673, after "the served line stays billed on `fix`", add: `⚠️ Changed by 02b v1.0 (Q-8), 03a v1.2: and on \`remake\` too — a remake frees nothing; a comp or a void does (02b O20). Was: "and is freed by 04 on \`remake\`".`
  - At :889, after "(free in the pilot, wastage, reason `kitchen_fault`; …)", add: `⚠️ Changed by 02b v1.0 (Q-8), 03a v1.2: 04 reads it for wastage and audit only; the served line stays billable, freed only by a comp or a void (02b O20). Was: "free in the pilot".`
  - Add §3.8a and §4.3 To 04 to the Q-8 "Where" cell in "Changes in v1.2" (:46).

### T-2 — MAJOR — Test 65 still asserts the `tableOwners` receiver
- **Where:** `03a_Timing_Engine_Spec_v1.2.md:1331` (test 65).
- **Problem:** Test 65 says "a `dine_in` slip goes to the `tableOwners` owner … also with 02's `tableOwners` present". Under Q-1 (§3.8 :656, test 120) the receiver is the holder of the group's oldest order from `holdersOfOrders`. A builder who keeps test 65 as written asserts the old rule next to test 120.
- **Fix:** Append to test 65: `⚠️ Changed by 02a v1.0 (Q-1), 03a v1.2: the dine_in receiver clause is replaced by test 120 (holder of the oldest order via registerSlipReaders); the delivery / takeaway / parking clause stands.` Test 113 (:1404, "a `dine_in` table with no owner") can say "no holder returned" in the same way.

### T-3 — MINOR — §1 Version row not bumped
- **Where:** `03a_Timing_Engine_Spec_v1.2.md:274`.
- **Problem:** The §1 header "Version" cell still reads "⚠️ **v1.0.1 APPROVED (owner, 2026-11-08; as built)**". The title (:1) and the status (:5) say v1.2 DRAFT.
- **Fix:** Prefix the cell with `**v1.2 DRAFT** (02p task 0, 2026-11-08; awaiting approval); was:` and keep the rest.

### T-4 — MINOR — Markdown: the §1 "Depends on" row has a third cell and no closing pipe
- **Where:** `03a_Timing_Engine_Spec_v1.2.md:275`.
- **Problem:** The v1.2 text was added after a new ` | `, and the row has no closing `|`. The table has two columns, so GFM drops the third cell, and the whole v1.2 dependency list (01a v2.3, 01c v1.1.2, 01d v1.2.1, 02a v1.1.1, 02b v1.0.1) does not render.
- **Fix:** Replace ` | *⚠️ 03a v1.2:*` with ` *⚠️ 03a v1.2:*`, and end the line with ` |`.

### T-5 — MINOR — The old rule is still stated in the main text with no pointer, in four places
- **Where:**
  - `:1108`: §6.2a step 2, "`dine_in` from 02's `tableOwners` — **one** statement for every table".
  - `:1114`: "2 (`listOpen`) + ≤ 1 (`tableOwners`) + 01d's …".
  - `:1458`: §10.5, "with work 2 + ≤ 1 + 01d bounds; … step 3 = 4 + 2 (v0.2) …; `fires_alerts` `tableOwners` only for `dine_in` keys".
  - `:1122`: §6.3 boot steps endpoint text, "Step 3: four replay statements …; two `stock_version` reads", with no id-set read.
  - Also `:206` (§3.1 #8), "`dine_in` → `tableOwners` (⚠️ …)", which reads as if `tableOwners` still holds.
- **Problem:** v1.1 edited these sentences in place. v1.2 instead leaves them unchanged and adds a block further down (:1118, :1462), and §6.3 gets no block at all. Someone reading step 2 or §6.3 alone reads the old rule as current. R-1 asks for the bound "everywhere it appears".
- **Fix:**
  - At the end of :1108 and :1114, append `(⚠️ superseded by the 03a v1.2 note below: holdersOfOrders + currentTableOf, R-1)`.
  - At :1458, append `(⚠️ superseded by the 03a v1.2 note below)`.
  - At :1122, after "two `stock_version` reads (§3.12, v0.2 pre-G2 #3)", add `; ⚠️ 03a v1.2 (Q-3, R-3): + one id-set read (§3.12), step 3 = 4 + 2 + 1`.
  - At :206, change "`dine_in` → `tableOwners` (⚠️ Changed by …: the holder …)" to "`dine_in` → the holder of the group's oldest order … (⚠️ Changed by 02a v1.0 (Q-1), 03a v1.2; was `tableOwners`)".

### T-6 — MINOR — R-3: the case where step 2 reads only one checkpoint row is not covered
- **Where:** `03a_Timing_Engine_Spec_v1.2.md:781` (§3.12 "Q-3 id set at boot", the H rule) and `:1431` (test 130).
- **Problem:** H = "the smallest `last_seq` among the checkpoint rows step 2 read …, 0 when step 2 found no checkpoint". With exactly one checkpoint row (the first close after go-live, or a fresh restore), H is that checkpoint's `last_seq`. That is the very sequence §3.12 shows: the only checkpoint C misses Z1 and H1, so a void gives the false warn R-3 is meant to remove. "Older of the checkpoints read" does not decide this case. Test 125's restart fixture also passes only when it writes two checkpoints, and it does not say so.
- **Fix (owner to confirm; within R-3's intent):** In :781 and test 130, use "**0 when step 2 found fewer than two checkpoint rows**". Add to test 125: "the fixture writes the previous day's checkpoint and C".

### T-7 — MINOR — Test 125's control clause conflicts with the as-built replay
- **Where:** `03a_Timing_Engine_Spec_v1.2.md:1426` (test 125).
- **Problem:** The test says "no `absent id` line: live, on full replay, and after a restart …; control: the same events on an unknown id still log one line each". As built, the absent-id line is logged **live only**: `logAbsentIds` runs in `afterEngineCommit` (`apps/hub/src/engine-host/reducer.ts:68-72`, comment :107-110), and `replayEngine` never calls it. So the control fails on the replay leg. On replay, only the zone `ItemAdded` shape is meaningful, because its old `line_not_listed` diagnostic is logged with `replay: true`.
- **Fix:** Reword as: "… → no `absent id` line live and after the restart; on full replay, no `invalid_event` diagnostic for the zone `ItemAdded`; control (live only): the same events on an unknown id still log one line each."

### T-8 — MINOR — R-2 label: which order, and what if `currentTableOf` has no entry
- **Where:** `03a_Timing_Engine_Spec_v1.2.md:656` (§3.8 Q-1 block) and `:1423` (test 122).
- **Problem:**
  - The text says the label comes "from 02a's `currentTableOf(db, order_ids[])`", but not which order's entry gives the primary table. The receiver rule names the oldest order.
  - It gives `null` only for "stubbed" and "primary table not in the config", not for "`currentTableOf` returned no entry for the order".
- **Fix:** In :656, use "the primary table of the group's **oldest** order (`order_ids[0]`) from `currentTableOf` …; `null` when the readers are stubbed, when `currentTableOf` returns no entry for that order, or when its primary table is not in the config". Add the no-entry case to test 122.

### T-9 — WORDING — Test 122's "0 statements" can be misread
- **Where:** `:1423`.
- **Problem:** "never joined, 0 statements" reads as if the label costs nothing. In fact `currentTableOf` is one statement, counted in test 121. Only the name lookup is free.
- **Fix:** Use "the name lookup adds 0 statements (the one `currentTableOf` read is counted by test 121)". Use the same wording in the R-2 ruling (:53, "0 statements") and in §3.8 (:656).

### T-10 — WORDING — `ReadOnlyDb` is not a type in the code
- **Where:** `:901` (§4.4 stub row), "each `(db: ReadOnlyDb, order_ids: string[]) → Map<order_id, …>`".
- **Problem:** No `ReadOnlyDb` type exists. `readOnlyDb(db)` in `apps/hub/src/engine-host/read-only-tx.ts:18` returns a `Database.Database`. Read literally, this names a new contract type.
- **Fix:** Use "`(db, order_ids: string[])`, where `db` is the tick's read-only view (`readOnlyDb`, a `Database.Database`)".

### T-11 — WORDING — The E-1 text sits in a row with empty Event and Stream cells
- **Where:** `:823` (§4.2 events table).
- **Problem:** The E-1 note is a separate row (`| | | ⚠️ … | 02b |`) under `OrderPlaced`. It reads as an unnamed event, and its Written-by cell says "02b" while the row above says something else.
- **Fix:** Move the text into the `OrderPlaced` row's payload cell (:822), after its existing payload, and delete row :823.

### T-12 — WORDING — Marker and ordering slips in 03a v1.2
- **Where:** `:26-27`; `:656`, `:1118`, `:1462`, `:1551`.
- **Problem:**
  - The version history lists v1.2 before v1.0.1.
  - Four markers read "⚠️ **⚠️ Changed by …" (doubled sign).
- **Fix:**
  - Move the v1.2 row below the v1.0.1 row.
  - Use one "⚠️".

### T-13 — WORDING — A sentence in the R-3 sequence is unclear
- **Where:** `:781`, "restart from C (or from a later snapshot: a snapshot holds engine state only, so its `last_seq` is never H)".
- **Fix:** Replace it with "restart from C. A restart from a later snapshot has the same gap: the id set is not in a snapshot, and H is taken from checkpoints only."

### T-14 — WORDING — 01d v1.2.1 / v1.2 text
- **Where:** `01d_Notifications_Requests_Spec_v1.2.1.md:1039`; `:21` (P-1 "Where"); `01d_Notifications_Requests_Spec_v1.2.md:8`.
- **Problem:**
  - :1039 has unbalanced parentheses: "`AlertDetailsBase` (`{ … lines? }`; ⚠️ 02p task 0, text only: … was the four fields), signed-in only, §3.12)".
  - P-1 lists "§8" as a place it changes, but §8 has no P-1 marker.
  - 01d v1.2 says "Superseded by **v1.2.1**", but v1.2.1 is still a draft.
- **Fix:**
  - At :1039, use "`AlertDetailsBase` (`{ item?, quantity?, amount?, reason?, minutes_late?, lines? }`, signed-in only, §3.12; ⚠️ 02p task 0, text only: `minutes_late`, `lines` per v1.1.2, was the four fields)".
  - Either add a one-line P-1 marker in §8, or drop "§8" from P-1's "Where".
  - In v1.2:8, use "To be superseded by **v1.2.1** (draft, 02p task 0)".

### T-15 — WORDING — Cross-spec pointers (note only)
- **Where:** `02a_Tables_Spec_v1.1.1.md:243`; `02p_Platform_Changes_Spec_v1.0.md:132`.
- **Problem:**
  - 02a §4.2's "Used by" for `currentTableOf` lists "02b edits, 03b, 05" but not 03a's slip label, even though task 0 touched 02a for the reader pair.
  - 02p U-7 still cites "03a v1.1 :878, :1151" for the bound.
- **Fix:**
  - In 02a :243, add "03a slip label (Q-1, via `registerSlipReaders`)" to "Used by" (text only, same n-3 marker).
  - Leave 02p unchanged: it is approved, and its tests map to 03a v1.2 tests 120–123. Optionally note "now 03a v1.2 test 121" when 02p is next bumped.

---

## Closure (lead, 2026-11-08)

| # | Status |
|---|---|
| T-1 | Fixed: Q-8 markers in §3.8a and §4.3 To 04; Q-8 "Where" widened |
| T-2 | Fixed: test 65 hands its `dine_in` clause to test 120; test 113 says "no holder returned" |
| T-3, T-4 | Fixed: §1 Version row bumped; "Depends on" row is one cell again, closing pipe added |
| T-5 | Fixed: "superseded" pointers at §6.2a step 2, the statement line, §10.5; §6.3 names the id-set read; §3.1 #8 reworded |
| T-6 | Fixed by owner ruling 2026-11-08: H = 0 when step 2 finds fewer than two kept checkpoints, else the older one's `last_seq` (§3.12, R-3 row); test 125 covers one and two checkpoints; test 130 |
| T-7 | Fixed: control clause is live only; replay leg checks the zone `ItemAdded` diagnostic |
| T-8, T-9 | Fixed: label = primary table of the oldest order; `null` also when `currentTableOf` has no entry; "the name lookup adds 0 statements" |
| T-10, T-11, T-12, T-13 | Fixed |
| T-14 | Fixed: 01d :1039 parentheses; §8 dropped from P-1 "Where"; 01d v1.2 says v1.2.1 is drafted on top |
| T-15 | Note only, not changed (02a :243 "Used by" and 02p U-7 line numbers left as they are) |

Re-check of the fix diff: not run.
