# Re-review: STAB-6 / STAB-7 post-review fixes

- **Branch:** `fix/stab-tablet-pairing` @ `010db644` (fix commits `0a8a6625`, `5fe68fb3`, `e3088431`, `010db644`).
- **Read:** first review and its Resolution table; `00_Foundation_Spec_v1.15.md` vs v1.14; `03a_Timing_Engine_Spec_v1.2.8.md` (§3.1, §3.3, §3.5.3, §3.5.7, §3.6.1, §3.8–§3.10, §3.12, §11, tests 56, 92, 106, 143–173); 02b v1.0.23 / v1.0.24; 01a v2.7.4; 01b v1.10.2 vs v1.10.1; 01c v1.1.3; 03b v1.0.13; README; `docs/plans/stab-6-7-plan.md`.
- **Code checked:** `packages/engine/src/slip.ts` (`lineEstimate`, `lineCrossing`, `groupCrossing`, `cookingLand`), `apply-event.ts` (groups, `ItemsReleased`), `apps/hub/src/orders/audiences.ts`.

## Verdict: FIX

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| MAJOR | 4 |
| MINOR | 9 |
| Flags (asked, not decided) | 3 |

Every B, M and m finding has a real fix in the specs. Most fixes are correct. Four of the new rules still have gaps. Two of them need an owner answer (R-1, R-2). The other two are text fixes (R-3, R-4).

---

## Resolution check

| Finding | Status |
|---|---|
| B-1 | Resolved. `priority_due` is its own map and does not depend on the slip threshold, an open alert or `skipped`. `next_alert_due_at` is the minimum of both maps, and test 153 has the three cases. One new gap: R-3 |
| B-2 | Resolved. `priority_land_ms`, `d_p`, one loop per group and test 155 are in place. One new gap: R-4 |
| B-3 | Resolved with reading (a). **The reading is accepted.** A slot priority line may take *free* capacity inside the freeze window, as a new row. That moves no frozen line, uses no D15 exception and matches D17 "append at the bottom" (03b §3.3 already lets a new order's line do this). P4 stands, because a frozen load is never joined or shed. So "what the cook already sees never changes" holds: the rows already on screen are unchanged, and only a new row can appear. See m-5 for the 03b wording |
| M-1 | Resolved. v1.15 has rows P-1–P-4, and each "⚠️ Changed by v1.15" marker keeps the old text ("Was: …"). The 03a D4 row is updated, the README row F is updated, and the story file is left alone on purpose |
| M-2, M-3, M-5, M-6, M-12 | Resolved as proposed. Tests 156, 163, 165, 149 and 148 now fail without their rule |
| M-4 | The owner decision is applied exactly (PR-4 batch option (b); test 164 fails on the old rule) |
| M-7 | The owner decision is applied exactly (minimum 60 000 on every layer, strict `>` in PR-3 and §3.8; test 166) |
| M-8 | Resolved (the `in` check; separate fixtures in 02b test 58 and 01a test 204) |
| M-9 | Resolved (01b v1.10.2 §6.10, test 115). See Flag F-2 |
| M-10 | Applied as written: the larger delay first, taken at the fold and stored; "no limit" = 30 min; default 5 min. **The stored key causes R-1** |
| M-11 | Applied in the text (`E_w > F`), but **it does not work for the owner's own example**: R-2 |
| M-13 | Resolved except three test parts that are placed in the wrong task (m-7) |
| m-1 … m-15, decisions 1–7 | Resolved as the table says |

---

## MAJOR

### R-1 The stored "larger delay first" key ranks by tick timing and by limit size, so an old priority group can be pushed back again and again — owner decision

**Where:** 03a §3.5.7 PR-4 "The priority order" and "Sticky"; §3.5.3 note; §3.6.1 item 2; test 167.

**Problem:**
- `priority_delay_ms` = the delay at the fold. The fold follows the crossing within one `fires_alerts` pass, so the stored value is about `limit(g)` plus 0–500 ms of tick phase, unless a jump (an overrun, a boost) overshoots.
- So the rank is really "larger limit first", with ties broken by tick timing. It never reflects how long a group has already been priority.
- PR-4 "Sticky" says "Only fixed input (a boost, an overrun or a slide, a capacity drop) can [move `priority_land_ms` later]". That is false: a later `LinePrioritized` with a higher rank re-places its group first and moves a lower-ranked group later.

**Failure:** a sustained rush with the 5 min default on every item.
- Group A is prioritised at 12:00 with a stored delay of 5:00.1.
- Every later group that crosses with 5:00.2–5:00.5 (about half of them, by tick phase) and every no-limit line at 30 min is placed ahead of A.
- A's `priority_land_ms` is pushed later again and again, without bound. This is the "pushed back without end" that STAB-7 was written to stop.
- A also loses to a group that it itself displaced. That group crossed later, but with a bigger jump.

**Fix (recommended; still "taken once and stored"):** rank by the **lateness onset** `priority_at − priority_delay_ms` (the instant the group's estimate passed `T`), earliest first; ties by the arrival key, then `order_item_id`.
- Delay grows at the same rate for every waiting group, so this is "larger delay *now* first".
- It never re-orders already-prioritised groups.
- A newer group can never overtake an older-late one, so nothing starves.
- Reword "Sticky" to name a higher-ranked priority fold as a cause that may move `priority_land_ms` later.
- Rewrite test 167 (P2 goes first only when its onset is earlier) and add a sustained-overload property: a priority group is overtaken only by groups with an earlier onset.

### R-2 `F(g)` uses planned lands, so condition 3 (M-11) cannot see an overrun or a slide, and test 168 passes without the rule — owner decision on the reading, then TXT

**Where:** 03a §3.5.7 PR-2 (`F(g)` = `(started_at ?? fire_ms) + prep + cook + carry`), PR-3 condition 3 and the line "so the entry is exact"; test 168. Code: `slip.ts` `cookingLand` (COOKING estimate = planned) and `lineEstimate` (fired-not-started lines use `packedEnd(line, t)`, which slides).

**Problem:**
- For a fired-not-started line, `F` uses `fire_ms`. §3.8's own estimate uses the packed Start, which moves with the clock (the STAB-6 slide).
- For a COOKING line that overruns, `F` is the planned end, not the live one.
- So `F` is too low exactly when the M-11 rule matters.
- The resolution note says a slide "is seen at the next fold". It is not: no fold changes `fire_ms`.
- Test 168, first half: the overrunning karahi's waiting raita and naan are held to `T`, so `E_w ≈ T` and no crossing happens with or without condition 3. Second half: drafting happens with or without it too. Neither half pins the rule.

**Failure:**
- The tandoor load holding the group's naan is fired but not started, and slides to `T + 12`.
- The group's raita, on a busy slot station, is estimated at `T + 6`. The limit is 5 min.
- `F = fire_ms + … = T`, so `E_w > F` and the group is prioritised.
- The raita jumps other tables, lands at about `T + 2` and waits 10 min at the pass for the naan. That is the useless push M-11 was meant to forbid, and it breaks PR-5's "never cook now and wait at the pass".

**Fix:**
- Define `F(g, t)` with §3.8's per-line estimate at `t`: the packed end for fired-not-started lines, and for COOKING lines `max(planned land, t + carry)`, if the owner wants an overrun to count. Today §3.8 counts no overrun, so state which.
- Make the `priority_due` entry the earliest `t` at which `E_w(t) > max(T + limit, F(t))`. That needs a bounded search like `firedCrossing`, because `F(t)` also rises.
- Alternatively, re-check condition 3 inside `getAlertIntents`, with a due that does not stay `≤ now` once the condition turns false.
- Rewrite test 168: (a) a waiting line past the limit with a fired-not-started line of the group sliding later than it → no draft; (b) the slide stops (Start tapped) and the waiting line becomes the latest → drafted.

### R-3 `priority_due` clamps an already-late group to "the fold's `recorded_at`", which repeats the bug AD-21 R1 fixed for slips — TXT

**Where:** 03a §3.5.7 PR-3 ("the earliest `t ≥` the fold's `recorded_at` … or the fold's `recorded_at` when a waiting line's estimate already exceeds the level"); test 106 ("per-group recompute equals a full recompute"); §3.8 AD-21 R1 (slips count from the order's `placed_at`; code `groupCrossing(…, g.order.placed_at, …)`).

**Failure:**
- Group g is already over its level at fold f1, so its entry is `f1`.
- The unrelated fold f2 does not touch g, so the entry stays `f1`.
- A full recompute at f2 gives `f2`.
- Test 106's property fails, and any full rebuild (for example `slipDueOf`-style at boot or in a test) differs from live upkeep.

**Fix:** use the same lower bound as the slip, the order's `placed_at` (R1). Keep the crossing formula unclamped. Drafting is "`≤ now`", so a due in the past drafts at once.

### R-4 The hold-and-fire floor `T_p` ignores the group's frozen siblings — TXT

**Where:** 03a §3.5.7 PR-4 "One loop per group" (`T_p` starts at the latest of each hidden line's earliest land, `F(g)` and the pickup). `F(g)` covers only fired, COOKING and done lines. Frozen lines are waiting, not hidden, so they are in neither term.

**Failure:**
- The group's karahi is frozen, with a planned land of `T + 8` (its own station is slow).
- The hidden naan was at `T + 12`, and priority lets it land at `T + 3`.
- `T_p = T + 3`, so the naan fires early and waits 5 min for the karahi. PR-5 is broken.

**Fix:** the floor also includes the planned land of every frozen line of g. Add a case to test 155.

---

## MINOR

| # | Where | Problem | Fix | Owner? |
|---|---|---|---|---|
| m-1 | 03a §3.3 BQ-4 | BQ-4 says a hidden load changes members "only when (a)–(f)". A priority join (PR-4 (a)) and a cascade shed are not on the list; (e) covers only the priority line leaving its own load | Add "(g) a priority placement (§3.5.7 PR-4: join and cascade shed)" | no |
| m-2 | 03a PR-4 cascade, §3.10 BQ-5 | Undefined: (1) a full load holds no non-priority member, so nothing can be shed; (2) after a capacity drop, a load's priority members alone exceed the new capacity | (1) Skip that load and join the next one with room or a non-priority member; (2) shed the lowest-ranked priority member last, by the same cascade. Add a test | no |
| m-3 | 03a PR-4 | The fold sets no `priority_land_ms` when g has no hidden line (all frozen or fired). A frozen priority line can become hidden again: a capacity change (a D15 exception) moves frozen lines. `d_p` is then undefined | "`null` → set by the line's first priority placement", as already written for released groups | no |
| m-4 | 03a test 172 | "No line waits more than `MAX_DELAY_NO_LIMIT_MS` + one cook past `T` without becoming priority" is false by design when a fired or COOKING line drives the delay (condition 3) | Restrict the assertion to groups where a waiting line drives the delay | no |
| m-5 | 03b v1.0.13 §3.3 "Priority" | "The row keeps its place (fire order)" and "may appear as a new row at the bottom of Next" disagree: a priority line in the freeze window can fire before older Next rows | Say which one: append at the bottom (D17) is the 03a contract | no |
| m-6 | 03b §3.3 / §6.17 vs 03a PR-8 | The chip is set "at once from its `delay_ms`", but the next frame uses `ceil((estimate − T)/60 000)`. The minute shown can jump. Harmless | Note it, or let the frame alone set n | no |
| m-7 | Plan tasks 8, 14, 16 | Three test parts sit in the wrong task. Task 8 runs #148's "priority member pulled first" before priority exists (16/17). Task 16 runs #155, whose naan is a **batch** priority line (batch placement is task 17). Task 14 extends #92 with "`next_alert_due_at` = min of both maps", but its own gate guard keeps the slip minimum until task 23 | Move #148's priority part to 17 and #155 to 17. In task 14, extend #92 for the `priority_due` map only; the `next_alert_due_at` part goes in 23 | no |
| m-8 | Plan release notes Q14 | "Replay the whole log" contradicts 03a §3.12 / §11 (the replay starts from the day-close checkpoint, which is the reason for m-13) | "replay from the night's checkpoint" | no |
| m-9 | Process: 03a v1.2.8, 02b v1.0.23/24, 01a v2.7.4, 01c v1.1.3, 03b v1.0.13 | Versions approved on 2026-11-22 were changed in place under the same number. CLAUDE.md says "update the spec version". They are marked, cite `c2fa5d11` and are not built, so no reader is misled today | Accept as an owner exception, or bump each to a patch version before the build | **yes** |

---

## Flags (asked to flag, not decide)

| # | Where | Point | Owner decision |
|---|---|---|---|
| F-1 | 01a MD-1 / MD-6, 01c §4.3, 03a PR-1 | An explicit item max delay can be 31–120 min, which is **more lenient** than "No limit" (prioritised at 30 min). An owner who types 45 gets later priority than one who picks "No limit" | Cap the item range at 30 min (1–30) or keep it as is; the owner app already shows both |
| F-2 | 01b v1.10.2 §6.10 (and 01a MD-4, tests 203, 204, 01b 115) | `422 VALIDATION_FAILED` breaks the **foundation** status map (F §6.2: `VALIDATION_FAILED` is 400, and 422 is for module-defined business codes). 01b's other range errors on the same `PATCH` return 400. This is a foundation conflict as well as a 01b inconsistency | Recommend 400 everywhere (a range is a schema check). Otherwise a module code such as `MAX_DELAY_INVALID` (422) appended to §6.2 |
| F-3 | `CLAUDE.md` "Source of truth" | It still names `00_Foundation_Spec_v1.14.md`; v1.15 is now the approved foundation | Owner edits CLAUDE.md (outside this review) |

---

## Checked and sound (no finding)

- **Determinism:** `arrived_at` (the listing event's `recorded_at`; returns come through `OrderLinesAdded`), `priority_delay_ms` (computed in the fold from the state, not the event), `priority_land_ms` (the fold's loop), `priority_at` (`recorded_at`) and `priority_due` (fold upkeep) are all folded from events and state only. Live = replay, and snapshot + replay = full replay, hold (subject to R-3 for the rebuild form).
- **Bounded work:** at most one `LinePrioritized` per group. The cascade is bounded by queue length. `priority_due` upkeep covers touched groups only, as `slip_due` does. An idle kitchen opens no transaction.
- **Foundation v1.15:** P-1–P-4 agree with 03a PR-4 / PR-7. "Bounded" holds per group (once), but R-1 shows priority lines are not bounded against each other.
- **Plan:** all 03a tests 143–173, 56, 92, 94 and 106, 02b 37/45/56–58, 01a 202–205, 01b 115, 01c 130 and 03b 91–96 have a task. The v5 bump is first (task 5), the replay list goes in with the fold (task 16), and the writer comes after the fold (task 23).
