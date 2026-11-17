# Hostile review of the 02a / 02b design briefs (2026-11-11)

Two fresh subagents, one per brief, each read the sources themselves (specs 02a v1.1.4 and 02b v1.0.5, plans and status boards, the inventory, the built hub code, upstream specs 00 / 01b / 01c / 01a / 01d / 03a / 03b, the 01d handoff and the ui-kit) and listed what was missing or wrong. Both verdicts: **FIX**. Every finding below was fixed in the brief. Where a finding is a real gap in data or behaviour (not a brief error), the fix is an honest statement in the brief plus an open question for the owner. No behaviour was invented.

## 02a Tables brief — 14 MAJOR, 13 MINOR (no BLOCKER)

| # | Sev | Finding | Fix in `02a-tables-design-brief.md` |
|---|---|---|---|
| 1 | MAJOR | Lock time-out was given as the role idle time; it is the branch setting `table_lock_ttl_ms` (1–60 min); the role idle time only ends the session | 3.25 `lock_ttl` row ("after {n} min", n from the branch setting), F12, §5 |
| 2 | MAJOR | `own_tables` scope described wrongly (it may open any free table; refuses actions on parties it doesn't hold); variant missing | §1.2 permission table; 3.10 new variant row |
| 3 | MAJOR | Open / Take order errors missing (`not_holder`, `TABLE_NEEDS_CLEANING`, stale `TABLE_SEATING_CHANGED` incl. a FREE tile, `404` archived, anywhere scope) | 3.6 new "Open / Take order errors" table |
| 4 | MAJOR | Clean never checks the lock: a table can be cleaned while someone types its first order | 3.19 "Clean anyway?" warning; 3.25 `TableCleaned` row; §5; Q22 |
| 5 | MAJOR | No banner when a non-holder's lock is released by a holder change | 3.25 row on `TableLockReleased { staff_id = me, holder_changed }` |
| 6 | MAJOR | Nobody told about a force move (R23) | 3.25 proposal rows for new and old holder; 3.13; Q21 |
| 7 | MAJOR | Handover waiting card has no data source (`my-requests` has no receiver name / table id); "my requests" area doesn't exist | 3.22 data note, placement (sheet + "Sent requests" strip), fallback text; Q20 |
| 8 | MAJOR | Call-waiter card can't show "from Ali" (no requester in display) | 3.24, F18; Q14 widened |
| 9 | MAJOR | A 0-recipient call holds the 5-min dedupe, so a retry rings nobody | 3.17 copy "call again in 5 min" + warning; §5; Q18 |
| 10 | MAJOR | Common errors missing (401 session, 403 grant without reason, 426, 400 reasons, lost answer) | 3.6 "Errors common to every command" table; 400 rows in 3.12, 3.14 |
| 11 | MAJOR | Phone answer sheet doesn't exist in 01d; in-person accept not mentioned | 3.21 phone row (new frame) + in-person row; Q19 |
| 12 | MAJOR | Greying other floors for `my_floors` can't be built (no floor list, no flag) | 3.6 state row; Q6 marked data gap |
| 13 | MAJOR | 02a-D25 name rule wrong for merges (`assigned_staff_id` can be the caller) | 3.20 new name rule, no Hand over button when null or me |
| 14 | MAJOR | Result notices carry machine text; withdraw sends no notice | 3.23 "never show `details.reason`"; withdrawn = no notice |
| 15 | MINOR | P-1d row pointed to a section that didn't say it | 3.6 "Drinks-only party" state; checklist row fixed |
| 16 | MINOR | Dangling ID "02a-C06"; emoji padlocks in copy | 3.7 fixed; emoji replaced with "padlock" |
| 17 | MINOR | "since 8:02 PM" on 02-B01 has no data | removed (3.8) |
| 18 | MINOR | Null-name fallbacks; releaser unknown on phones; archived raw id | 3.7 fallbacks; 3.25 "by a manager" |
| 19 | MINOR | Tile ids not listed | 3.7 ids row |
| 20 | MINOR | Force move errors wrong ("as D20"); handover 404 source; Touch/Release seating-changed; own-other-screen lock on Move | 3.13 explicit list; 3.12 404 from the query; 3.25 rows; 3.14 lock row; 3.8 "You're ordering on another screen" |
| 21 | MINOR | Detach wording ("no orders of its own") wrong | 3.16 |
| 22 | MINOR | "Call sent" marker can't clear on a close frame; `repeated` has no time | 3.17 |
| 23 | MINOR | Queue log: 401 → Send again as the current person | 3.26 |
| 24 | MINOR | other_owner dialog devices; floor with no tables; archived group under a floor filter; `IP_LOCKED_OUT` | 3.20, 3.6 states, 3.2 |
| 25 | MINOR | Palette default went against the spec | §2.1 and Q1: spec palette wins; ask before final frames |
| 26 | MINOR | Offline: can the holder keep ordering on an open table? | 3.26 "Draft while offline" |
| 27 | MINOR | A role with `force-release-table-lock` but no `take-order` would see actions that fail | 3.10 variant row and Hand over rule |

## 02b Ordering brief — 1 BLOCKER, 14 MAJOR, 19 MINOR

| # | Sev | Finding | Fix in `02b-ordering-design-brief.md` |
|---|---|---|---|
| 1 | BLOCKER | Takeaway / parking order view had no data for stage, `fired`, promise (catch-up has no stage; no per-order query) | 3.15 rewritten: data gap stated, a buildable default (Served / Not served, Ready n/m, hub-resolved actions); Q19 |
| 2 | MAJOR | Kitchen progress (started / done / un-done) not pushed to staff screens | 3.14 warning + "Updated … · Refresh"; 3.25 note; Q17 |
| 3 | MAJOR | Plain options and order note not in table-view data | 3.14 "Not shown after Send"; Q18 |
| 4 | MAJOR | Weighed items can take a weight at order time | 3.8 "Enter weight now / Weigh later"; F7 |
| 5 | MAJOR | Counter items can be comped after the undo window | 3.14 Comp row, 3.19 copy, §5 |
| 6 | MAJOR | "N left" threshold invented; setup has a per-item low-stock threshold and `level`; `not_counted` state missing | 3.6 rows; Q1 rewritten |
| 7 | MAJOR | Send back visibility contradicted the 30-min flow; "Closed" wrong for abandoned unserved lines | 3.14 stage rows and "Send it as a new item" action; 3.18 note |
| 8 | MAJOR | g/ml deal remove rule wrong (applies to g/ml parts, also before start) | 3.17, §5 |
| 9 | MAJOR | Queued takeaway: no "token arrived" state | 3.13 "Queued order sent" state |
| 10 | MAJOR | No state for timeout / 5xx / lost answer | 3.13 "Still sending"; 3.29 non-queued "Couldn't confirm — try again"; 3.30 row |
| 11 | MAJOR | take-order-anywhere overstated (fails if someone holds the lock; scope checked) | 3.4 lock row; F19 |
| 12 | MAJOR | Late card has two built answer paths (accept vs ReleaseItems) | 3.24 "Two ways to answer" |
| 13 | MAJOR | Both briefs claimed 02-B02 with different copy | one shared bar and copy in both briefs (02a 3.26, 02b 3.29); 02a points to 02-D14 for the log |
| 14 | MAJOR | Not self-contained: kit classes by name only; palette deferred to the 02a brief | new §2.9 component anatomy; palette inlined in §2.1 |
| 15 | MAJOR | Comp card: no table code for takeaway / parking; raw reason code; default chips ignored | 3.19 default chips; 3.20 variants and code mapping; Q15, Q21 |
| 16 | MINOR | Q10 (12 h) already ruled | Q10 removed |
| 17 | MINOR | Windows need a per-minute re-check; multiple windows; `opens_at_ms` null | 3.6, 3.11 |
| 18 | MINOR | Sold-out way out for deal choices / linked options; first-refusal only; STATION_PAUSED mapping | 3.11 |
| 19 | MINOR | Send back missing "not served yet"; Boost errors | 3.18 row; 3.23 |
| 20 | MINOR | No word for a no-station line | 3.14 stage row "No kitchen" |
| 21 | MINOR | Remove takes the free lock and nothing releases it | 3.17 note; Q20 |
| 22 | MINOR | Offline: Add items for the holder; stale marker | 3.4, 3.14, 3.25 |
| 23 | MINOR | Who marks a counter takeaway served (cashier has no mark-served) | Q23 |
| 24 | MINOR | "Send it as a new item" permission; no takeaway path | 3.14 action row; 3.18 note; Q5 |
| 25 | MINOR | 01d bits: `out_of_range`, `in_person_elsewhere`, `no_approver` banner; copy and step facts; "item changed" marked proposal | 3.20 |
| 26 | MINOR | Line fields missing (`parent_order_item_id`, `added_at` + `zone_undo_ms`, null name); weight-pending total; g/ml stepper | 3.14 |
| 27 | MINOR | Late card raw stage words; name fallback | 3.24 |
| 28 | MINOR | "My zones first" has no data; STOCK_INSUFFICIENT units | 3.27; Q22 |
| 29 | MINOR | Queue log: Copy to a new order only for orders; `DEVICE_TOKEN_INVALID` | 3.30 |
| 30 | MINOR | Abandoned dine-in tap target; Q12 filter source | 3.25; Q12 |
| 31 | MINOR | No IDs for 02-B03 / B06 / B07; three checklist rows pointed to the wrong place | screen list; §8.1, §8.5 rows fixed |
| 32 | MINOR | "Not reachable" without take-order presented as fact | 3.4 marked proposal; Q16 |
| 33 | MINOR | Plate is ASCII only; send back / new round clear the bill request; banner text; slow chip source | 3.3, 3.18, 3.4, Q9 |

## Verdicts

- 02a reviewer: **FIX** → all 27 fixed.
- 02b reviewer: **FIX** → all 33 fixed (the blocker became a stated data gap with a buildable default plus owner question Q19).
- No second review was run (the task asked for one per brief).
