# 11 Smart Store — G0 (idea, scope, architecture direction)

| | |
|---|---|
| Status | **G0 draft — Proposed, needs approval** (developer, 2026-11-02). Idea capture before any brainstorming; no spec. Build after the POS pilot (2027-02-28) unless the developer decides otherwise. |
| Sources | Developer design chat 2026-11-02 (smart bins, the "stone swap" scenario, standalone product); `docs/stories/product-roadmap.md` (08 Inventory & Costing, 09 Gas, 10 Vendor payments); 01d v1.1 (alerts, requests), 01e (ESP32 device gateway, planned), 00 v1.6.1 (hub platform). |
| Related | 08 Inventory & Costing, 09 Gas monitoring, 10 Vendor payments — together: "where a restaurant's money leaks". |

---

## 1. Problem

Every branch has a store (small in one, packed in another; more spices at a branch whose menu needs them). Stock disappears and nobody knows when, what or who. Counting and weighing by hand is skipped in practice, and staff who take stock "do anything": take more than asked, swap a bag for a stone of the same weight, refill a jar with something else.

## 2. What Smart Store is

Real-time, digital measurement of stock **where it sits**, tied to **who opened the store and why**, with a **camera clip for every suspicious change**:

- weight sensors (load cells) under bins, canisters and sacks;
- a store "session": who opened the store, when, for which request;
- every weight change recorded as an event, matched against the request;
- anomalies raised as alerts with the camera clip attached.

## 3. Product goals (developer, 2026-11-02)

| # | Goal |
|---|---|
| P1 | **Fits any restaurant**: small or large store, few or many spices, any menu; configuration, not code. |
| P2 | **Integrates 100 % with our POS** (same staff, ingredients, alerts, devices). |
| P3 | **Sells on its own** to a restaurant that does not use our POS. |
| P4 | **Expensive add-on**: hardware + monthly software. |
| P5 | Built first to solve Arif Chatkhara's own losses; the pilot data becomes the sales case study. |

## 4. Architecture direction (proposed): one platform, editions

| Option | Description | Verdict |
|---|---|---|
| A. Separate software | own login, devices, sync, offline, alerts; integrates with the POS through an API | duplicates the platform; integration never complete |
| **B. One platform, editions** | shared base: 00 (hub, login, devices, events, sync), 01d (alerts and requests), 01e (ESP32 gateway). Modules on top: POS modules, **Store**, Gas, Vendor payments. A tenant runs only what it bought | **proposed**: Store standalone = platform + Store; with the POS, integration is automatic |

**Consequence — platform licensing (new, needed for POS packs too):** the tenant record carries the **editions / modules it has bought**; the hub and cloud turn modules on or off; every module declares what it needs from others and how it behaves without them. Not in the foundation today → a small foundation + 00 bump, owned by its own spec.

**Without our POS:**
- Store keeps its own small **ingredient catalog** (a subset of 08's model, the same tables so an upgrade to the POS keeps the data).
- A **connector** for another POS (CSV upload or API) brings in sales, so recipe-based expected usage still works; without it, Store works on "what was taken, by whom, for what".

## 5. Hardware: modular kit

| Module | For | Example |
|---|---|---|
| **S bin** (up to ~5 kg) | spice jars, packets | laal mirch, zeera, elaichi, zafran |
| **M platform** (~30–50 kg) | tins, canisters | ghee, oil |
| **L floor platform** (~100–150 kg) | sacks | aata, chawal, cheeni |
| **Shelf controller** (ESP32 + load-cell amplifiers) | 4–8 bins per shelf | plug, pair through 01e, map bins to items |
| **Issue station** | tablet + bench scale + camera at the store door | every store |
| **Door kit** | door sensor + RFID / PIN, optional electric lock | starts and ends a session |
| **Camera** | clip on events only | cheap IP camera or ESP32-CAM |
| **Freezer kit** | door sensor + camera; meat weighed at issue, issued in labelled pre-weighed portions | load cells inside freezers are unreliable |

A small store: issue station + a few S bins. A large store: several shelves, many bins, floor platforms. Same software.

## 6. Editions (draft)

| Edition | Contents |
|---|---|
| **Store Basic** | issue station (scale + tablet + PIN), door kit, event camera, stock and issue records, alerts |
| **Store Pro** | Basic + smart bins on chosen items, real-time stock per bin, anomaly detection |
| **Store Max** | Pro + multi-branch central store and transfers, camera vision, receiving by weight with vendor records (with 10) |
| **+ POS** | recipe-based depletion, food cost, theoretical vs actual (08), automatic |

## 7. Core features

| # | Feature |
|---|---|
| F1 | Items and units (from 08 with the POS; Store's own catalog standalone); packets counted by unit weight (2.4 kg ÷ 200 g = 12) |
| F2 | Bin map: which bin, which item, where, capacity, tare |
| F3 | Real-time stock per bin and per item |
| F4 | Sessions: who opened the store, when, for which request |
| F5 | Issue requests and approvals (01d request kinds) |
| F6 | Receiving by weight against the order / invoice (with 10) |
| F7 | Anomaly detection (§8) with the camera clip attached |
| F8 | Calibration, auto-tare, drift handling, tolerance per bin |
| F9 | Offline-first on the hub; owner view in the cloud |
| F10 | Reports: issues by person / shift, anomalies, variance, slow stock |

## 8. Anomalies (draft catalogue)

| # | Signal |
|---|---|
| A1 | A bin changed during a session but was **not in the request** |
| A2 | **Taken and refilled** in one session (weight drops, then returns): the "stone swap" |
| A3 | Weight dropped **with no session** (store closed) |
| A4 | Door opened **outside hours** |
| A5 | Bin weight **does not fall** as recipe usage says it should (08): something was added (stone, water, filler) |
| A6 | Taken more than requested |
| A7 | Slow drift on a bin (small repeated losses) beyond the sensor's own drift |
| A8 | Receiving: delivered weight below ordered / invoiced (with 10) |

**The stone swap, end to end:** Hamza requests 1 kg namak. In the same session the laal mirch bin drops 1 000 g and returns to the same weight. A1 + A2 fire → manager alert with the session's 20-second clip. Later, recipe usage of laal mirch does not lower the bin as expected (A5) → the swap is confirmed at the next refill or count.

## 9. Integration contracts with the POS platform

| With | Contract |
|---|---|
| 00 | tenant, branch, staff, devices, sessions, events, sync |
| 01d | alert kinds (anomalies), request kinds (issue request, approval) |
| 01e | shelf controllers, door kits and cameras paired as devices; compact device protocol |
| 08 | ingredients, units, recipes, expected usage, variance; Store events feed actual stock |
| 09 | the same ESP32 sensor family and gateway |
| 10 | receiving by weight, vendor records |
| Other POS | sales connector (CSV / API) |

Events (draft names): `BinWeightChanged`, `StoreSessionOpened`, `StoreSessionClosed`, `IssueRequested`, `IssueRecorded`, `StoreAnomalyRaised`, `BinCalibrated`.

## 10. Honest risks

1. **Focus:** building it before the POS pilot slows both. Proposed: build after the pilot.
2. **Hardware support:** stock of parts, installation, repairs, calibration; needs an installer or partner later.
3. **Upfront cash:** hardware stock and test units.
4. **Sensors drift** (heat, time, leaning on a bin): tolerances, auto-tare, calibration tools.
5. **People adapt:** weight alone is beaten (water, filler); camera + recipe reconciliation are required, not optional.
6. **Unvalidated demand:** no other owner has been asked yet.

## 11. Plan (proposed)

1. **Now:** this G0; platform licensing gets a slot in the roadmap (it also serves POS packs).
2. **Validation this month:** tell 3–5 restaurant owners the story (the Rs 5 million vendor fraud, stock theft, the stone swap and how it is caught); ask "would you install it, for how much?"
3. **After the POS pilot:** Lake City pilot — one shelf (ghee, oil, laal mirch, zeera) with smart bins + the issue station + door kit + camera, 3 weeks of data.
4. Then the first sale outside Arif Chatkhara.

## 12. Open questions (for G1)

| # | Question |
|---|---|
| Q1 | Architecture B confirmed? Licensing spec: where it lives (foundation, 00, own module) |
| Q2 | Which items get smart bins at Lake City; store layout and size per branch |
| Q3 | Access model: who holds the key today; how often the store opens; electric lock or sensor only |
| Q4 | Issue flow: store keeper hands out, or self-service with a request |
| Q5 | Camera: where, how long clips are kept, privacy notice for staff |
| Q6 | Freezer and meat: portioning and labels, who weighs |
| Q7 | Tolerances per bin size; calibration routine and who does it |
| Q8 | Standalone catalog vs 08: the shared table model so a Store customer can upgrade to the POS without losing data |
| Q9 | Other-POS connector: which POS systems are common in Lahore; CSV first? |
| Q10 | Pricing: hardware sold or rented; monthly software price per edition |
| Q11 | Installation and support model (own team, partner, training) |
