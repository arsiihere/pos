# STAB-6 proposal: batch stations cook in rounds, in arrival order ("A + C") — with STAB-7 (max delay → priority)

Status: **spec draft, awaiting owner approval** — 03a v1.2.8 DRAFT (`docs/specs/03a_Timing_Engine_Spec_v1.2.8.md`) and
02b v1.0.23 DRAFT (`docs/specs/02b_Ordering_Spec_v1.0.23.md`). Fix chosen by the owner on 2026-11-22: **A + C**. The owner asked for STAB-7 (max delay → priority, `docs/plans/stab-7-max-delay-proposal.md`) to go into the same 03a draft, so one engine change is approved; see §10. No code
until the owner approves the drafts and answers §9.

## 1. Problem (owner report, 2026-11-22)

Batch station: a tandoor cooks 8 naan per load in 3 min; fryer baskets work the same way.

1. **A later order is cooked in an earlier round than an earlier order.**
2. **An order bigger than one round (×10 on 8) is pushed behind later small orders.**

Root cause (the code follows 03a v1.2.7; class **(b)**, a rule change):

- A fired load that is not Started **slides** with the clock (03a §3.3 "Fired, not started", `live.ts:94,141`), so every
  re-plan finds the hidden loads behind it late.
- Pass 1 **re-forms hidden loads line by line** (03a §12.3 G4-1 #10, J4; `replan.ts:595-610`). Older members become
  late, and the §3.5.6 search orders them by EDF on their fixed deadlines (AD-12, `plan.ts:776`; J5–J7). That puts
  their new load behind later ones.
- New immediate lines then **join the room the older members left** (F §4.7 "earliest not-yet-fired load with room",
  `batch.ts:121`).
- A line over a load **holds whole loads** (AD-4, `profile.ts:19-23`): ×10 on 8 takes two full rounds. It cannot use
  the 3 free spots of a round that holds 5, so smaller later lines fill those spots first.

The owner's rule: *"The tandoor cooks in rounds. Orders go into rounds in the order they arrive. An order fills the
empty spots in the next round first, and whatever doesn't fit goes into the round after."* First-come-first-served
rounds win over freshness re-shuffling. The tawa (1–17 at once, independently) is a slot station and STAB-5 already
covers it.

## 2. Evidence (scratch runs with the real engine, 2026-11-22)

The kit: `packages/engine/test/batch-kit.ts`, capacity 8, cook 3 min, Waada Guard (freeze 2 min, keep 1 min),
freshness 2 min, immediate lines. `getTickIntents` is folded every 15 s. The cook taps Start 2 min after each fire and
never taps Done (the scratch files are deleted). Orders: A ×5 at +0, B ×10 at +1, C ×2 at +2, D ×2 at +3, E ×4 at +5,
F ×3 at +7, G ×2 at +9, H ×1 at +12. Times are minutes from the first order.

| Run | What happens |
|---|---|
| v1.2.7, lines as sent (two-tap) | B ×10 holds two whole rounds (fires +4, AD-4), so C, D, E wait behind it (promised +13 / +14; fired +12, started +14, land +17) |
| v1.2.7, B split 3 + 7 by hand | E (placed +5) fires +14 instead of its promised +13. **F (placed +7) fires +19, behind G (placed +9) and H (placed +12), which fire at +14** |
| v1.2.7, every line split per unit (two-tap) | The same inversion: E3, E4, G, H fire at +14; **F1–F3 fire at +19** (load F:E3). Splitting alone does not fix the order (**A is needed**) |
| v1.2.7, per unit, `single_tap` | Perfect rounds: [A×5] +0, [B1–8] +3, [B9–10 C D E1–2] +6, [E3–4 F G] +9, [H] +12. No slide, so no re-sort (**C works once A holds**) |
| v1.2.7, ×10 joins a hidden load holding 5 | Unsplit: B's `eta` is +12 (two rounds [6, 12)); a later C ×3 joins A's round and lands at +6, **before B**. Per unit: B1–B3 join A's round (`eta` +6), B4–B10 form [6, 9) (`eta` +9): **"3 now, 7 next"** |

So the per-unit split (C) gives the owner's rounds when no load slides. With two-tap stations the slide still makes
the re-plan re-sort the loads, so the queue rule (A) is needed as well.

## 3. The rule in plain words

- **Rounds are a queue.** The tandoor's waiting rounds keep their order and their contents. A re-plan may move a
  round earlier or later in time, but it never breaks a round up, never moves an order out of its round into a later
  one, and never puts a later round in front of an earlier one.
- **A new order fills the empty spots of the earliest waiting round it can join**, then starts the next round. A naan
  ×10 is sent as 10 one-naan parts (like STAB-5's karahi ×5), so "×10 on an 8-round holding 5 → 3 now, 7 next". Staff
  and customers see the parts with their own ready times: "3 ready ~2:10 · 7 ready ~2:14".
- **When the tandoor runs late** (a round fired but not started), every round behind it moves later together, in order.
  Lateness shows as a slip. Weights (follow-up, expedite) no longer reorder rounds. Only a **Boost** jumps the queue,
  as today, and it is marked.

## 4. Design (against the code)

### 4.1 A — the batch queue (engine, `replan.ts` `batchPass1` only)

Today `batchPass1` takes every hidden load apart. It re-places the members one by one in pass-1 order (join a load
within freshness, or form one at `latestFit`), and the late ones go through `overloadPlace`. The new version works on
whole loads:

1. `queue` = the station's stored unfired loads sorted by `(booked.start, load_id)`. Frozen, pruned (D25) and held
   (boost) loads stay fixed, as today.
2. Each **hidden** load `b`, in queue order (BQ-2):
   - `d(b)` = min over its members of `d(m) + prep(m) − max_prep` (today's J7 / `overloadUnit` deadline);
   - `lo` = max(`t`, the members' `d − max_early_ms`, the previous load's new start − `max_prep`);
   - `fire = latestFit(lo, d(b) − keep) ?? latestFit(lo, d(b)) ?? earliestFit(max(t, prev start − max_prep))`.
     The last one is the late case. `capped` is set when `fire − d(b) ≥` the binding member's `max_late_ms`;
   - the load goes back with the same members and name (`storeLoads` already handles a changed booking).
3. No `overloadPlace` on a batch station (§3.5.6 is not applied there). A §3.11 old-type slot booking that was pushed
   late is placed at its earliest fit after the queue.

Pass 2 is unchanged: `placeBatchImmediate` / `trySyncAt` already join the **first compatible load in start order with
room** or form a new load in the free time pass 1 leaves. Because loads no longer lose members, the only room a new line
can find is real room. That is "fills the empty spots in the next round first".

Cases:

| Case | Behaviour |
|---|---|
| Capacity drop (lane off, BQ-5) | A hidden load over the new capacity keeps its first members (join order = arrival) up to the capacity. The rest join the next queued load with room, else a new load directly after it. A frozen load keeps P4 (whole, AD-4 rounds). Fired and COOKING loads are fixed. A capacity rise leaves the loads; new lines use the room |
| Void / remove / partial void | The load keeps its name, place and other members (AD-7, AD-5). The room is **not** refilled from later rounds (Q1). The next new line or the fire's pull-in (§3.6.1 item 1) may use it |
| Program differs (D49) | Loads of different programs share the queue in start order. A line only joins a load of its program, as today |
| `StockAdded` flip | The flipped member leaves its hidden load (`flipPlacement`, unchanged). The load keeps the rest. The line is placed like a new line |
| Freshness | Join rules unchanged (sync: within `min(window, max_early_ms)`). A moved load keeps today's per-member lower bound `d − max_early_ms` |
| Sync vs immediate | Both join or form loads by today's rules. The queue keeps whatever they formed |
| Boost / expedite | Boost unchanged (B5: the boosted lines' own load, held, marked). Expedite only changed a weight, and weights no longer reorder a batch queue (Q3) |
| Lanes / overrides | As a capacity change (BQ-5) |
| FIFO-policy batch station | Unchanged: it already keeps its stored loads |
| The slide | Unchanged. It is physical, and with A the queue behind it moves later together. `single_tap` stays an optional mitigation |

### 4.2 C — split per unit at `SubmitOrder` (02b, `apps/hub/src/orders/expand-parts.ts`)

`expandParts` splits a piece line (not weighed, not zone) whose routed station is `slot`. With C it also splits lines on
a `batch` station, so the change is `=== 'slot'` → `∈ {slot, batch}`, and the same for a deal's chosen part. Ids
(`<id>-p<k>`), `part_of`, prices, stock draws, option children, the id check (step 3) and the preview are STAB-5's,
unchanged. The engine then places the parts in listing order. The first parts join the earliest load with room, the
rest form the next load(s), and each part gets its own `eta_ms`.

**What happens on a re-plan when the room changes after the split:** nothing special. Every part is an ordinary
one-unit line in its load, and A keeps the loads together. A void opens room (Q1), a capacity drop sheds the latest
parts to the next round (BQ-5), and a capacity rise leaves room for new lines. No re-split is ever needed, because a
one-unit part is the smallest piece.

### 4.3 Rejected

| Option | Why not |
|---|---|
| Split into **load-sized** parts (×10 → 8 + 2) | The 8 part cannot use the 5-of-8 round's 3 spots ("2 now, 8 next", not "3 now, 7 next"). A chunk of more than one unit can still wait for room. STAB-5 found the same with capacity-sized chunks |
| Split at `SubmitOrder` by **reading the engine's current room** | The room a line will join depends on the placement itself (program, freshness, sync hold, the other lines of the order), so the hub would have to run the plan twice. The room also changes at every re-plan, so the split would go stale |
| Split **inside the engine** (one line spread over loads) | A line has one `load_id`, one fire and one stage. Events, KDS Start / Done, voids and the bill are per `order_item_id`. That would mean new state and events everywhere |
| "Joiner takes the load's earliest deadline" (the STAB-6 row's second option) | It hides the re-sort for one join but not for the slide plus re-form, and it adds a deadline rule |
| Only `single_tap` on batch stations | It removes the slide, but the owner wants the rule to hold with two-tap stations. It stays a mitigation |
| Keep §3.5.6 for batch with the queue as a tie-break | Weighted lateness re-sorts by deadline, which is exactly what the owner rejected |

## 5. Trade-offs

- **Freshness:** a round is no longer reshuffled to land each naan closest to its own target. Members of one round
  land together; the join window still limits how early a sync naan may land. The owner chose this.
- **Load fill:** a room opened by a void stays open until a new line or the fire's pull-in takes it (Q1). A capacity
  drop sheds parts to the next round instead of holding the station for AD-4 rounds (Q4).
- **More lines:** a naan ×10 is 10 lines (as STAB-5 made karahi ×5 five lines). Pass 1 on a batch station now works
  per load, not per line, so a re-plan gets cheaper. The tick and the fold see more lines. `pnpm test:perf` (03a §7.1)
  must be re-run on the owner's machine, never in the cloud.
- **Gap loads:** a new load may use idle time before a load held for a later pickup (it delays no one, Q2). That load
  is then ahead in the queue, so if it slides, the held load moves with it.

## 6. What changes per module

| Module | Change | Spec |
|---|---|---|
| 03a engine | `batchPass1`: the queue (BQ-1, BQ-2), the capacity shed (BQ-5), no batch `overloadPlace`. The batch tests that pinned the re-form and the batch Λ search are replaced (tests 143, 144, 147). Nothing else in `plan.ts`, `batch.ts`, `live.ts` or `tick.ts` | 03a v1.2.8 DRAFT |
| 02b hub | `expandParts`: slot **or batch**; tests 37, 45 updated, 56, 57 new | 02b v1.0.23 DRAFT |
| 02b client | None: the cart's per-part times, the order view grouping and remove-by-count are STAB-5's | — |
| 03b KDS / Pass | Patch: at a batch station the part grouping (`part_of` + stage) also keys on `load_id`, so "Naan ×3" (this round) and "Naan ×7" (next round) are separate rows. Start / Done act on the load as today (03a To 03b #9) | 03b v1.0.13 (to draft after approval) |
| 03c / 05 | None: tickets, bill, receipt, credit note and the customer ready times already group by `part_of` (05 v1.0.33 / v1.0.34) | — |
| 04 | None beyond STAB-5 phase 4 (void / return by count, not started yet) | — |
| Foundation | No rule change (Q-F1) | — |

## 7. Tests (numbered in the drafts)

- 03a #143 rounds in arrival order through a slide (§2's scenario: rounds [A×5], [B×8], [B×2 C×2 D×2 E×2],
  [E×2 F×3 G×2 H×1]; fails on v1.2.7). #144 a hidden load is never broken up (members, names and order kept; replay =
  live). #145 "3 now, 7 next". #146 new lines never jump the queue (and the idle-gap case). #147 the late queue keeps
  its order whatever the weights; `capped` / `station_overload`. #148 a void keeps the load. #149 a capacity drop sheds
  the latest parts. #150 a program flip. #151 `single_tap` gives the same rounds.
- 02b #37 (batch line split), #45 (deal with a batch part split), #56 (preview / submit: 3 + 7 `eta_ms`), #57 (cart row
  "3 ready ~2:10 PM · 7 ready ~2:14 PM").

## 8. Build plan (after approval; small TDD tasks, one commit each, gate green)

1. **02b split (hub):** failing tests 37 (batch), 56; `expandParts` slot ∨ batch; deal part (45). `[02b v1.0.23 §3.2
   step 4a; STAB-6]`
2. **Engine test kit + 145:** the "3 now, 7 next" test with parts. It passes today (scratch run), so it pins C.
   `[03a v1.2.8 BQ-6, #145]`
3. **Engine queue (A):** failing tests 143, 144, 147; rewrite `batchPass1` steps 1–5 as the BQ-2 queue walk; drop the
   batch `overloadPlace` path; replace the two pinned batch tests. `[03a v1.2.8 §3.3 BQ-1, BQ-2, §3.5.3, §3.5.6]`
4. **Membership cases:** tests 146, 148, 150 (expected to pass after task 3; fix what fails). `[BQ-3, BQ-4]`
5. **Capacity shed:** failing test 149; the BQ-5 overflow walk in `batchPass1` (the hidden loads of the capacity fold).
   `[§3.10 BQ-5]`
6. **Regression:** test 151 and the full engine suite; the simulator scenarios (§10.6).
7. **03b patch** (draft 03b v1.0.13 first): KDS / Pass grouping key + `load_id` at a batch station; client tests.
8. **Gate** (`TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`); then
   the owner runs `pnpm test:perf` on the real disk.

## 9. Owner questions (each with a recommendation)

1. **A void (or remove) opens room in a waiting round.** Should the next round's earliest naan move up into it (strict
   arrival order), or should the room stay for the next new order? **Recommend: leave it for the next new order** (and
   the fire's pull-in). It is rare: it needs a void of a waiting naan in a full round. Moving up adds a second
   re-splitting rule.
2. **Idle time before a round held for a later pickup.** May a new order's round use it (it delays no one), or must
   every new round go after the last waiting round (foundation's literal "station_free_at")? **Recommend: use the idle
   time.** Today's engine already does this (J3), and it costs nobody anything.
3. **Weights and expedite on a batch station.** Follow-up / expedite weights and the overload search no longer reorder
   rounds; only a Boost (marked) jumps the queue; lateness shows as a slip. **Recommend: yes**, it is the owner's
   first-come-first-served rule.
4. **A capacity drop (fryer basket off)** with a waiting round over the new size: move the latest naan to the next
   round (BQ-5), or keep the whole round as one double-length load (AD-4)? **Recommend: move the latest to the next
   round** ("whatever doesn't fit goes into the round after"). A round already frozen (about to be loaded) stays whole.
5. **Multi-unit option children and deal parts on a batch station** (for example a thali with "2 naan" as an option
   child, or a deal part of 2 naan per deal) stay one line of 2 (AD-4). Split those per unit too? **Recommend: not
   now**; follow up if the menu has them. Naan is usually its own line.
6. **Orders already open when this ships** keep their rounds as they are (no re-split). **Recommend: yes** (STAB-5 Q3).
7. **KDS rows across rounds:** "Naan ×3" in this round and "Naan ×7" in the next show as two rows (03b patch). **Recommend:
   yes.**
8. **Stop-gap until this ships:** set the tandoor (and the fryer) to `single_tap` if the cook does not tap Start. It
   removes the slide, so the rounds stay in order today (§2, single-tap run). The ×10 issue stays until C ships.
   **Recommend: yes, if the cook does not tap Start.**

**Foundation (Q-F1, no edit made):** no 00_Foundation v1.14 rule changes. F §4.7's batch ETA already places a new load
after the station's reservations and keeps "first batch b … with room". F §4.7 "Fire rule: never past the latest-start
of the earliest-deadline item" still holds unless the queue is late, which is today's overload case. F's "re-planned
on every submit within slack" (03a F-3 / F-19 marker) is read as "a hidden load is re-placed as one unit". Please
confirm that reading. If you read it as per item, the foundation needs a bump (owner-approved, README R34).

## 10. STAB-7 in the same draft: max delay, then priority

The rule is the one the owner agreed (`docs/plans/stab-7-max-delay-proposal.md` §4). It is written as 03a v1.2.8 §3.5.7,
rules PR-1–PR-8, tests 152–161.

**Root cause:** 03a v1.2.7 has no push-back limit and no priority. Only promise deadlines and the overload weights apply.
Once a disturbance makes a line late (a slide, an overrun, a capacity drop, a boost, an overload with `max_late_ms`
null), each later re-plan may push it again, and nothing on the KDS says why.

**Design against the code, consistent with A + C:**

- **The limit (PR-1).** `ItemAdded.max_delay_ms` is a D25 copy (the item's value, else the branch default; `null` = no
  limit). The engine never reads menu config for it.
- **The delay (PR-2).** The group's estimate (§3.8, the same function as the slip) minus the group's target `T`. An
  "as ready" line is its own group.
- **The trigger (PR-3)** sits in `fires_alerts`, beside the slips. `getAlertIntents` already computes the estimates.
  The crossing goes into `slip_due[key]`, so `next_alert_due_at` stays exact and an idle kitchen opens no transaction.
  It writes one new event, **`LinePrioritized`** (order stream), so live, replay and the screens agree. Rejected:
  deciding priority inside a re-plan fold. That misses delays that grow between events (a slide), and the tick could
  not tell the KDS.
- **The fold (PR-4)** marks `priority_at` (sticky) and re-places the lines with the **boost path for those lines only**
  (§3.9 machinery: hold-and-fire against fixed lines; the D15 exception for frozen lines of others).
  - On a **slot** station, pass 1 then always places priority lines first, at their earliest fit (`replan.ts`
    `pass1Order` / the slot loop), so new orders never push them. Auto-fill (`tick.ts`) takes priority lines first.
  - On a **batch** station the line moves into the first unfired round of its program. When that round is full, its
    latest non-priority member moves back through BQ-5's walk. This is STAB-6's queue with one sanctioned jump, so A
    and STAB-7 use one ordering rule: arrival order, then priority, then boost.
- **Kept (PR-5, PR-7):** `max_early_ms` (never fire before `d − max_early_ms`), and fired / COOKING lines (never
  pre-empted).
- **Weights (PR-6)** order only non-priority lines on slot stations. Batch queues have no weights since BQ-2.
- **Cost:** `ENGINE_STATE_VERSION` 4 → 5 (two `EngineLine` fields; full replay at upgrade), one event type, one optional
  `ItemAdded` field. No endpoint, migration or error code in 03a.

**Rows for other specs (not written; the owner approves them with this draft):**

| Spec | Row |
|---|---|
| 01a Restaurant Setup | `menu_items.max_delay_ms INTEGER NULL` (≥ 0; the owner app shows minutes, next to "Can be ready early by"; empty = branch default); branch setting `max_delay_default_ms` (default 300 000 = 5 min; `null` = no limit by default); a migration ADD COLUMN; config snapshot and `BranchConfig.items[].max_delay_ms` |
| 01c Menu Variants | `ItemAdded.max_delay_ms?: number \| null` (additive at v1, no upcaster; absent = no limit), 01c §4.3 |
| 02b Ordering | §3.2 build: copy the item's value or the branch default onto every line's (and part's) `ItemAdded.max_delay_ms` (03a To 02 #13); a test |
| 03b KDS + Pass | "Priority · n min late" chip on KDS and Pass rows from the views' `priority`; `LinePrioritized` reaches station / pass sockets (03a To 03b #10); client tests |
| 01d | none: the existing `slip_warning` reaches the manager by its step 1 |

**STAB-7 owner questions:**

9. **Measure the delay from the kitchen target `T` or from the customer promise `P` (= `T` + padding)?** **Recommend:
   `T`**, the same as the slip card's "≈ n min late". Priority then starts before the customer's promise is broken.
10. **Branch default:** 5 min, with "empty = default" and an explicit "no limit" choice per item? **Recommend: yes, 5
    min.** The slip threshold (2 min) is below it, so the order taker hears first and priority follows.
11. **Manager alert:** no new alert. The slip raised earlier escalates to managers at `slip_escalate_ms`. Or should a
    priority crossing escalate at once? **Recommend: keep the existing slip** (no 01d change). Revisit if managers
    miss it.
12. **A priority line in a full batch round** moves that round's latest non-priority member to the next round. Or should
    it only take free room and otherwise go first into the round after? **Recommend: move the latest member back.**
    That is "first into the next round".
13. **Priority after a Boost:** a boost may still go ahead of a priority line (a human jump, marked). **Recommend: yes.**
14. **Rollout:** `ENGINE_STATE_VERSION` 5 means a full log replay at the first boot after the update (minutes at pilot
    volume). **Recommend:** ship STAB-6 and STAB-7 as one engine update, after hours.

**Build tasks (after the STAB-6 tasks of §8):** S7-1 events (`LinePrioritized`, `ItemAdded.max_delay_ms`), state v5
(tests 160); S7-2 the crossing in `getAlertIntents` / `slip_due` (153); S7-3 the fold and the slot priority placement,
plus pass 1 priority-first (152, 154, 155, 157, 159); S7-4 batch priority with the BQ walk (156); S7-5 auto-fill (158);
S7-6 views (161), then 03b's chip; S7-7 the 01a / 01c / 02b rows above.
