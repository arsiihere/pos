# 01c Menu — Gate G2 (spec completeness check)

Checked against the README "Module spec approval checklist" (12 Module-mode sections, Inherits, Consistency), CLAUDE.md, carried conventions C1–C9, D64 and R26.

---

## Run 1 — v0.1 (`docs/specs/01c_Menu_Variants_Spec_v0.1.md`, commit fb70b64), 2026-10-28

**Verdict: FAIL.** Sections are present, endpoints are in budget and every story AC has a test. It fails on open load-bearing items (D-1 money, D-3 data integrity, two owner assumptions that shape data and money), several partial sections, and a §4.5 cost list that names a folder that does not exist.

### Sections

| § | Status | Notes |
|---|---|---|
| 1 Header | partial | No "next step" for the gate after G2 (hostile review G4); scope does not say karahi/naan/lassi are seed examples only |
| 2 Existing architecture | complete | — |
| 3 Domain rules | complete | V1–V17 named; D-3 left open in §6.15 R2 |
| 4 Contracts | partial | §4.3 example is abridged but not marked; `deal_part.price_minor` = "list price" is ambiguous; §4.6 builder drops every group with no options, required ones included; §4.5 cost list wrong in places (fixes 9–11) |
| 5 Data model | complete | — |
| 6 Endpoints | partial | C4 order broken in 6.9 / 6.16; 6.2 returns a meaningless `changed_versions`; §6.0 table has no hub rows |
| 7 Cross-cutting | complete | — |
| 8 Client contract | complete | — |
| 9 Errors | partial | `CONFIG_IN_USE.used_by.entity` new values not listed |
| 10 Tests | partial | No tests for 6.10 / 6.13 read statement counts or for 6.19's own behaviour; the "unconfigured station" edge maps to a vague "01a test"; AC4 test 21 does not show a different station or cook time |
| 11 Build order | complete | — |
| 12 DoD, checklist, open questions | partial | D-1, D-3, D-5 open; D-2 provisional with no carried row; owner assumptions 2 and 9 are load-bearing and open |

### Endpoint count

01c's own routes: **14 new** (6.1, 6.2, 6.6–6.16, 6.22). 01a routes it changes: 8 (6.3–6.5, 6.17–6.21). Own routes 14 are in budget (10–25); even counted with the changed routes (22), no split is needed (> 30).

### Story AC → endpoint → test

Every row of §10.9 has an endpoint and at least one test (11/11). Weak rows: "E0-MENU edge: unconfigured station" (no 01c test named), "zero-price add-on" (implicit in test 36), "E0-MENU AC4" (test 21 does not override station or cook time).

### Overrides (D64, R26)

Named: F §4.7, F §5.9 step 5 (V5); 01a S23 for new tables (V13); 01a S28 c (V1, V12); 01a §6.9, §6.12, §6.13, §6.15 in-use checks (V16); E1-ROUTE AC1 narrowed (V7); C5 application (V15); C4 divergence inherited (V13). **Unnamed: 0.** R26 "target spec bumped": not done, by instruction (the draft must not edit 01a/01b/README); §4.5 lists every change for application on approval.

### Writes and edge-case tables

All 16 writes have a table after the v0.1 fix-ups. 6.19 refers to 6.18's table (acceptable).

### Load-bearing assumptions (data model, events, snapshot, money)

| Item | Kind | State |
|---|---|---|
| D-1 allocation with a zero-weight part | money | open |
| D-2 one order item per line vs n | events | provisional, no carried row |
| D-3 choice item `sale_unit` change bypasses the deal rule | data model | open; default was a silent builder drop |
| D-5 `BusinessDayOpened` v2 `draws` | events | open |
| ASSUMPTION-2 shared pot | data model | open owner question |
| ASSUMPTION-9 extras on weighed lines once per line | money | open owner question |

### Internal mismatches

- §12.2 maps 6.10 to test 36 and 6.13 to test 49, which test the POSTs; 6.19 maps to "63 (re-keyed 01a 130)".
- §4.5 cost list: `packages/events/src/upcasters/` does not exist (upcasting is `upcastFromPrevious` on each event definition, `registry.ts`); `draft.ts`, `badges.ts` are `.ts`, not `.tsx`; missing `packages/events/src/admin/hub.ts` (stock command and query schemas keyed by `item_id`), `apps/cloud/src/lib/config-audit.ts` (`AuditEntity` union), `packages/engine/fixtures/engine-log.v1.json` (a new log fixture for the bumped engine version), client tests `BusinessDay.test.tsx`, `StockTable.test.tsx`, `stock-pages.test.tsx`; the `isStockTracked(config, item)` → `isStockTracked(item)` change and its four callers are not listed.
- §4.6 says stock items sort by `lower(name)` without saying the builder sorts in JavaScript (canonical stability).
- §6 vs §9 status codes: consistent (all codes used are in §9 or earlier catalogues).

### Fix list (numbered)

1. §1: next step = hostile review (G4) in a fresh session; say the dishes are seed examples and the model is generic.
2. §6.9 / §6.16: move the `archived` check after the version compare (C4 step 4).
3. §6.2: remove `changed_versions` from the response.
4. §6.0: add rows for the hub commands (6.18–6.22).
5. §4.3: mark the example abridged (every key is present on every line); fix `deal_part.price_minor` wording (F2).
6. §4.6: keep required groups with `options: []` (F1); state the JavaScript sort for stock items.
7. §4.4 02 row: align with fix 6.
8. §9: list `CONFIG_IN_USE.used_by.entity` values.
9. §4.5: replace `upcasters/` with `upcastFromPrevious` in the v2 event files; `.ts` names; add `admin/hub.ts`, `lib/config-audit.ts`, engine log fixture, the three client tests.
10. §4.5 A5: add the `isStockTracked` signature change and its callers.
11. §4.5: state the endpoint budget on 01c's own routes.
12. §10: add tests for 6.10 and 6.13 statement counts, 6.19's own behaviour, a variant routed to an unconfigured station, an explicit zero-price add-on; make test 21 override station and cook time.
13. §12.2: fix the test mapping for 6.10, 6.13, 6.19.
14. Resolve D-1, D-3, D-5; carry D-2 to 02.
15. Close owner assumptions 2 and 9 (G3).

---

## Run 2 — v0.2 (`docs/specs/01c_Menu_Variants_Spec_v0.2.md`), 2026-10-28

**Verdict: PASS.**

| Criterion | Result |
|---|---|
| Missing sections | **0.** §1–§12 present, in README order (checked by heading scan) |
| Endpoints in budget | **15** own routes (6.1, 6.2, 6.6–6.16, 6.12a, 6.22), inside 10–25; 23 touched with 8 changed 01a routes, under the split limit (30) |
| AC coverage | **100 %**: 14/14 rows of §10.9 (story ACs, carried rows, G3 rows) map to an endpoint and a numbered test; tests numbered 1–92 with no gap or duplicate |
| Unnamed overrides | **0.** F §4.7, F §5.9 step 5 (V5); 01a S23 (V13), S28 c (V1, V12), S59 (V18), §6.9/§6.12/§6.13/§6.15 (V16, §6.5 R6); E1-ROUTE AC1 (V7); C5 (V15); C4 divergence (V13) |
| Open load-bearing assumptions | **0.** D-1, D-3, D-4, D-5 answered; D-2 carried to 02 with a re-check rule; no `[ASSUMPTION-N]` tag remains; owner facts closed in §12.5 (G3 answers) |
| Writes with edge-case tables | 17/17 (6.12a added); merged-row rules named per PATCH/PUT |

### Fix list from run 1

| # | Status |
|---|---|
| 1 | Done: §1 next step G4; "Generic model" row |
| 2 | Done: §6.9, §6.16 archived check after the version |
| 3 | Done: §6.2 response |
| 4 | Done: §6.0 hub table |
| 5 | Done: §4.3 abridged note; `deal_part.price_minor` (F2) |
| 6 | Done: §4.6 rule 3 (F1); JavaScript sort for stock items |
| 7 | Done: §4.4 02 row |
| 8 | Done: §9 `CONFIG_IN_USE` entities |
| 9 | Done: §4.5 cost list (`upcastFromPrevious`, `.ts` names, `admin/hub.ts`, `lib/config-audit.ts`, engine log fixture, client tests, `set-item-availability.ts`) |
| 10 | Done: §4.5 A5 `isStockTracked` and its callers |
| 11 | Done: §6.23 budget on own routes |
| 12 | Done: tests 77–80; tests 21 and 36 strengthened |
| 13 | Done: §12.2 mapping |
| 14 | Done: D-1, D-3, D-5 resolved; D-2 carried |
| 15 | Done: G3 answers (§12.5) |

### Notes for the hostile review (G4)

- Author's calls AU-1–AU-6 (§12.3), chiefly AU-2: option-name uniqueness moved from a partial unique index to a service check under the group lock, so per-branch option rows survive option edits (upsert instead of delete + insert).
- R26 bumps of 01a (→ v2.0), 01b (→ v1.2) and the README rows are listed in §4.5 and applied only on approval, by instruction.
