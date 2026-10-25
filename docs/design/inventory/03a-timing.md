# 03a — Timing Engine (package + hub host): screen inventory

**No spec yet.** The engine (`@pos/engine`) and its hub host have almost no screens: they compute ETAs, fire times, slips and batches that **02 and 03b display**. Sources: stories E4-ETA, E4-HF, E4-SLIP (engine side), E1-FLR AC3 (live capacity, D37), E5-PWR AC5 (missed fires), D3 (boost), D23, D33–D36, D42–D44, D48 (ClockAlarm); foundation §4.7, §5.8; README R4, R6, 03a carried requirements. Built **before or alongside 02**. Conventions in [00-index.md](00-index.md).

---

## 1. Who and where
| Who | Device | Network | How often | Conditions |
|---|---|---|---|---|
| Staff with `boost-order` | T, K, P (from 02-S06) | Hub | A few per rush (VIP, complaint) | Rush; reason never shown to others (D3) |
| Manager changing live station capacity (D37; permission TBD — Q1) | T, K at the pass | Hub, works offline | When a cook goes on break or a second tandoor is lit; a few per day | Rush; must be 3 taps |
| Owner/manager setting thresholds (slip, slow, lock TTL, escalation) | L / T | Cloud (settings are data, R18) or hub — Q2 | Rarely | — |
| Everyone (sees engine output) | all | — | constant | — |

## 2. Jobs to be done
| # | Job | Story AC | Acceptance |
|---|---|---|---|
| J1 | As an order taker, I need ETAs that include prep, queue wait and cook time (stock time when stock > 0) so that the promise is real. | E4-ETA AC1–3 | shown on 02-S05 / 02-D07 |
| J2 | As a cook, I need each item fired at its latest-start time so that an order lands together. | E4-HF AC1–3, AC6 | FIRE NOW on 03b-S01 |
| J3 | As a cook at a batch station, I need compatible items pulled into the load within the freshness window. | E4-HF AC4; D49 | shown on 03b-S02 |
| J4 | As staff with `boost-order`, I need to move an order to the front so that a complaint is fixed, without telling others why. | E4-HF AC5; D3 | displaced orders get slip warnings with no reason |
| J5 | As a manager, I need to change a station's live capacity during service so that ETAs match who is cooking. | E1-FLR AC3; D37 | immediate recalculation; displaced orders get slip warnings |
| J6 | As a waiter, I need a slip warning when an order runs late so that I tell the customer first. | E4-SLIP AC1–4 | engine emits `SlipWarned`; screens are 03b-N01 |
| J7 | As a manager, I need to know when the hub clock was wrong at boot so that times are trusted. | E5-OFF edge; D48 | ClockAlarm banner on admin and every KDS |
| J8 | As a cook after a power cut, I need missed fires sent at once so that nothing is forgotten. | E5-PWR AC5 | FIRE NOW + slip warnings; no re-fire |

## 3. Screen list
| ID | Name | Kind |
|---|---|---|
| 03a-D01 | Boost this order? | dialog (from 02-S06 More) |
| 03a-S01 | Station capacity now (live override per station) | hub admin screen |
| 03a-D02 | Change capacity confirm with impact ("3 orders will be later") | dialog |
| 03a-S02 | Timing settings (slip threshold, slow threshold, lock TTL, slip escalation time, overrun step) | settings screen (home: Q2) |
| 03a-B01 | Clock alarm ("The hub's clock was behind…") | banner on hub admin pages and every KDS |
| 03a-B02 | Hub restarted — catching up (missed fires sent) | banner (KDS + admin) |
| 03a-C01 | ETA display rules (clock time, never truncated, "together at") | component spec for 02/03b |

**Count: 7.**

## 4. Per screen

### 03a-D01 Boost
- **Entry:** 02-S06 → More → **Boost** (hidden without `boost-order`; "needs approval" marker if `requires_approval`). **Text:** "Cook T7's order first? Other orders may be a few minutes later." Optional reason (Q3 — logged only, never shown to waiters). **Buttons:** Cancel / **Boost** → `BoostOrder` (proposed; command_id). **Result:** new ETAs for T7; KDS shows boosted marker (03b-B03); displaced orders get standard slip text (03b-N01) — **never** "VIP". Audited (E6-AUDIT AC2).
- **States:** busy; order already ready/billed (ITEM_WRONG_STAGE-like code TBD); offline (queued? Q4).

### 03a-S01 Station capacity now
- **Layout:** one row per active station: name, set capacity (from 01a), **now** stepper (− 4 +), "Back to normal". Shows current load ("3 cooking · 5 waiting").
- **Field:** live capacity (integer ≥ 0? Q5), `capacityOverride` (null = normal). **Action:** `SetStationCapacity` (proposed), command_id, permission Q1, works offline (hub). **Feedback:** 03a-D02 before applying when it delays orders.
- **Sample:** Tandoor 12 → 8 (one tandoor-wala on break); Karahi counter 4 → 5 (second stove).
- **Steps:** 3 taps.

### 03a-S02 Timing settings
| Setting | Default | Unit | Source |
|---|---|---|---|
| Warn when an order is later than | 5 | min | `slip_threshold_ms` (E4-SLIP AC1) |
| Tell the manager if a warning isn't acknowledged within | ? | min | E4-SLIP AC3 (no default given) |
| Show an item as slow when its full cook time is over | ? | min | E2-SOLD AC2 (no default given) |
| Release a table nobody touched for | 10 | min | `table_lock_ttl_ms` (D51) |
| Move late items later in steps of | 1 | min | `cascade_step_ms` (D44) |
All LTR numbers. Branch-level or restaurant-level — Q2.

### 03a-B01 Clock alarm
Danger banner: "The hub's clock was behind at start-up. Times continue from 13:42; check the hub's clock battery." Source `ClockAlarm { source: 'boot' }`; 06 adds `cloud_offset` (06-B02). Stays until? Q6.

### 03a-B02 Catching up
Info banner on KDS / admin for ~1 min after boot: "Hub restarted at 13:02 (down 4 min). 3 late items were sent to the kitchen." Data: `HubStarted` audit (`hub_down_at`, `missed_fires`). Q7 (is this wanted?).

### 03a-C01 ETA display rules
- Always an absolute clock time in hub time ("13:27", 24 h or "1:27 PM" — Q8); never "~", never "25+ min".
- Sync items: "Together at 13:27"; immediate items: their own time.
- Late: original time kept, plus "6 min late" (D6) — never silently replaced.
- Stock-time items show the fast time; when stock hits 0 the slow time (switch is automatic).

## 5. Flows
1. **Boost after complaint:** 02-S06 T7 → More → Boost → 03a-D01 → KDS 03b-S01 moves T7 to top with marker → T3 and T9 get slip warnings "running 4 min late" (03b-N01).
2. **Cook on break:** 03a-S01 Tandoor 12 → 8 → 03a-D02 "5 orders will be later" → Apply → slip warnings to affected waiters.
3. **Power cut at 13:00, back 13:04:** hub boots ≤ 90 s → missed fires dispatched → KDS FIRE NOW (03b-B05) + 03a-B02 → slip warnings for late orders.

## 6. Data shown
ETAs (`etas[]` in SubmitOrder result), `target_land_time`, `latest_start_at` (KDS sort), `FireDispatched`, `SlipWarned { order_id, items, minutes_late }`, `ReservationsShifted`, station load, `capacityOverride`, `ClockAlarm`, `HubStarted`.

## 7. Cross-module links
Needs 01a stations/programs/items, stock (`availableStock`, `canServeFromStock`); 02 order events. Gives ETAs to 02, queues/fires/batches/hold-at-pass to 03b, slip events to 03b notifications, `TableLockReleased` (tick) to 02.

## 8. Open questions (owner)
- **Q1** Who may change live capacity? A new permission (e.g. `manage-stations`) or `manage-stock`?
- **Q2** Where do timing settings live: owner app (cloud, branch settings 01b-S07) or hub admin? Per branch or per restaurant?
- **Q3** Should a boost ask for a reason (logged only)?
- **Q4** Can a boost be queued while the hub is unreachable? (It needs the live queue, so probably not.)
- **Q5** Can live capacity go to 0 (station closed)? What happens to its items?
- **Q6** When does the clock alarm banner go away?
- **Q7** Show a "hub restarted" banner to the kitchen, or only FIRE NOW?
- **Q8** 12 h ("1:27 PM", story example "10:47 PM") or 24 h clock on screens and tickets?
- **Q9 (spec OQ4)** Tap-rate field test results decide each station's default completion mode and whether overrun/hold-at-pass ship in P1.
- **Q10** Defaults for slip escalation time and slow threshold are not in any story.

## 9. Design status
Not designed.

## Story AC → screen IDs
| Story AC | Screens |
|---|---|
| E4-ETA AC1–3, AC5 | 03a-C01 (shown on 02-S05, 02-D07) |
| E4-ETA AC4 (same queue, no priority) | no screen (rule) |
| E4-ETA edges | 02-D07, 03b-S01 |
| E4-HF AC1, AC2, AC2a | 03a-C01 ("together at"); 03b-S01 |
| E4-HF AC3, AC6 (fire now) | 03b-B05 |
| E4-HF AC4 (batch pull-in) | 03b-S02 |
| E4-HF AC5 (boost) | 03a-D01, 03b-B03 |
| E4-HF AC7 (nothing hardcoded) | no screen (rule) |
| E4-SLIP AC1 (threshold) | 03a-S02 |
| E4-SLIP AC2–4 | 03b-N01, N02 |
| E4-SLIP AC5 (customer page) | **no screen** (P2, D20) |
| E1-FLR AC3 (live capacity override) | 03a-S01, D02 |
| E5-PWR AC5 (missed fires) | 03b-B05, 03a-B02 |
| E5-OFF edge (clock wrong at boot) | 03a-B01 |

**ACs with no screen:** E4-SLIP AC5 (customer tracking page, P2).
