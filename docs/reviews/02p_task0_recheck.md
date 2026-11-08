# 02p task 0 — re-check of the targeted-check fixes

| | |
|---|---|
| Scope | `git diff 73ff815..HEAD -- docs/specs` only: `03a_Timing_Engine_Spec_v1.2.md`, `01d_Notifications_Requests_Spec_v1.2.1.md`, `01d_Notifications_Requests_Spec_v1.2.md`, `README.md` |
| Commits | `fde1218`, `b9fafb2`, `c312b4d` |
| Against | `docs/reviews/02p_task0_targeted_check.md` (T-1–T-15 and its closure table); owner rulings R-1–R-3 and T-6 (2026-11-08); 02a v1.1.1 §4.2; 02b v1.0.1 §4.5 |
| Date | 2026-11-08 |

## Verdict

**APPROVE WITH WORDING FIXES.** T-2, T-6 and the R-1 / R-2 / R-3 text check out. 02a §4.2 types and 02b §4.5 Q-8 agree with the diff. The tables in the diff are well formed: the OrderPlaced row with E-1 is one 4-cell row, the §1 Depends on row has 2 cells, and v1.2 now sits after v1.0.1 in the version history. The findings below are small, and none needs an owner ruling.

## Findings

### R-1 — MINOR — T-1 is applied, but three places still give the remake a bill effect
- **Where:** `03a_Timing_Engine_Spec_v1.2.md:888` (§4.3 To 04); `:825` (§4.2 events table, `ItemReturned` row); `:284` (§2 Out of scope).
- **Problem:**
  - At :888 the old text was left in place as current text, followed by the Q-8 marker: "04 **reads** it: the served line's bill effect (free in the pilot, wastage, reason `kitchen_fault`; …). ⚠️ Changed by 02b v1.0 (Q-8) … Was: "free in the pilot"." Read from the top, the paragraph still says the served line is free, then says it is not. §3.8a :673 and §3.1 #11 :209 replace the text correctly.
  - :825 says "04 reads it for the bill effect and wastage". :284 says "the returned line's bill effect and `ItemReturned` → **04**". After Q-8 (02b O20), 04 reads `ItemReturned` for wastage and audit only, so a remake has no bill effect. Neither line has a Q-8 marker, and the Q-8 "Where" (:41) leaves out §4.2 and §2.
- **Fix:**
  - At :888, replace "the served line's bill effect (free in the pilot, wastage, reason `kitchen_fault`; audit with who returned it)" with "wastage (reason `kitchen_fault`) and the audit row with who returned it; the served line stays billable, freed only by a comp or a void (02b O20)". Keep the marker as "⚠️ Changed by 02b v1.0 (Q-8), 03a v1.2: was "the served line's bill effect (free in the pilot, …)"".
  - At :825, replace "04 reads it for the bill effect and wastage" with "04 reads it for wastage and audit (⚠️ Changed by 02b v1.0 (Q-8), 03a v1.2: was "for the bill effect and wastage")".
  - At :284, replace "the returned line's bill effect and `ItemReturned` → **04**" with "the returned line's wastage and audit (`ItemReturned`) → **04** (⚠️ Q-8, 03a v1.2: was "bill effect")".
  - At :41, widen the Q-8 "Where" to "§2, §3.1 #11, §3.8a, §4.2, §4.3 To 04".

### R-2 — MINOR — T-6 does not say how a torn checkpoint row counts
- **Where:** `03a_Timing_Engine_Spec_v1.2.md:771` (§3.12, "Q-3 id set at boot"); `:54` (R-3 row); tests 125 (:1425) and 130 (:1430).
- **Problem:**
  - The rule says "H = the older `last_seq` when step 2 read two kept checkpoint rows", else 0.
  - Step 2 (:761) reads `LIMIT 2` so it can fall back past a torn or unparsable newest row. Suppose step 2 reads two rows, the newest is torn, and the older one is C. Boot then restores from C, and the wording gives H = `C.last_seq`. That is exactly the gap the §3.12 sequence describes: the read misses Z1 and H1, and a void on them logs a false warn.
  - The owner's intent ("fewer than two kept checkpoints → 0") covers this case only if a torn row does not count. The text does not say so.
- **Fix:**
  - In :771, replace "when step 2 read two kept checkpoint rows" with "when step 2 read two **parsable** kept checkpoint rows"; after "fewer than two kept checkpoints", add "(a torn or unparsable row does not count)".
  - Mirror this in the R-3 row (:54).
  - Add a clause to test 125: "two rows, the newest torn → the read starts at seq 0, no false warn".
  - In test 130, replace "two kept checkpoints" with "two parsable kept checkpoints".

### R-3 — WORDING — T-12 left one doubled warning sign
- **Where:** `03a_Timing_Engine_Spec_v1.2.md:1550` (§12.2 row 6.2a): "*⚠️ ⚠️ Changed by 02a v1.0 (Q-1), 03a v1.2, R-1:*".
- **Problem:** T-12 listed four doubled markers, and the closure says T-12 is fixed. Three were fixed (:656, :1117, :1461), but this one was not.
- **Fix:** Use "*⚠️ Changed by 02a v1.0 (Q-1), 03a v1.2, R-1:*".

---

## Closure (lead, 2026-11-08)

| # | Status |
|---|---|
| R-1 | Fixed: §2, §4.2 `ItemReturned` and §4.3 To 04 now say wastage and audit, with Q-8 markers; Q-8 "Where" widened |
| R-2 | **Open for the owner**: whether a torn or unparsable checkpoint row counts toward "two kept checkpoints" (it extends the T-6 ruling) |
| R-3 | Fixed: single ⚠️ in §12.2 row 6.2a |

03a v1.2 and 01d v1.2.1 stay DRAFT: one MINOR (R-2) is open (owner rule 3 of 2026-11-08).
