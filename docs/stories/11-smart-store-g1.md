# 11 Smart Store — G1 (brainstorming record)

| | |
|---|---|
| Status | **G1 in progress** (developer + Claude, started 2026-11-02). One question at a time; each answer becomes a decision S-G1-n. No spec, no code. |
| Builds on | `docs/stories/11-smart-store-g0.md` (G0 draft, Proposed) |
| Read before G1 | G0; `product-roadmap.md` (08 I1–I24, 09 G1–G8, 10 V1–V10); `specs/README.md` (module map, R1–R34, C1–C9, carried rows); foundation v1.8 §1–§2, §4.1, §5, §6; 00 v1.6.1 §3.3–§3.8, §4.2, §5.1; 01d v1.1 §3–§4; `01d-g0-decisions.md` §2–§3; 01c v1.1 V3/V4 and `stock_items` DDL (for the shared-catalog question) |
| Order of topics | 1 Architecture → 2 Hardware → 3 Sensing and anomalies → 4 Data model and events → 5 Contracts → 6 Operations → 7 Business → 8 Pilot vs later |

---

## 0. Findings from the read (facts the decisions must respect)

| # | Finding | Where | Why it matters for Store |
|---|---|---|---|
| F-1 | `stream_type` is a **closed enum**: `order, table, station, stock, shift, audit, hub, staff`. | foundation §4.1 | A new `store` stream needs a foundation bump (R34). |
| F-2 | Replay reads only the stream types the engine reducers use (F-9); `stock` is one of them (pre-cooked `StockSet` / `StockReserved` / `StockReleased`). | foundation §5.8 step 3 (v1.8 F-9) | Putting `BinWeightChanged` on `stock` would load 03a's 90 s boot replay with sensor traffic. |
| F-3 | `device_type` CHECK is `tablet, cashier_kiosk, kds, phone`; 01e already plans to widen it (`pager_bridge`, G0 D5). | 00 §3.3, §5.1 | Shelf controller / door kit types should ride **01e's** widening, not a second 00 bump. |
| F-4 | 01c `stock_items { name, stock_unit, carries_over }` has **no `kind`** (R28 adds `'prepared'` / `'ingredient'`); `stock_item_branches.station_id` is **NOT NULL** and references `stations`. | 01c v1.1 V3, §5.1 | A Store-only tenant has no kitchen stations; "same tables as 08" needs a nullable station or a store location. |
| F-5 | 01d alert events live on the **subject's stream**; `defineAlertKind.subject` is a stream type; alert event files are re-exported per subject stream. | 01d §3.1 A3, §4.2 | Store anomaly alerts on a new `store` stream need that stream accepted by 01d (small, additive). |
| F-6 | Requests are 01d alerts with a request part (`approval` or `named`), answered with PIN where `needs_pin: 'always'`; owning module registers `apply`. | 01d §3.3, §3.5 | An issue request (IssueRequested → approve → open store) can be a 01d request kind; no new request machinery. |
| F-7 | ESP32 devices: compact device protocol, no queue on device, hub receive time is the fact's time, M44 pairing with a display code / setup AP. | 01d G0 §3 G1–G7 | A shelf controller **cannot** follow G4 ("no queue, ignore presses") — weight changes while the hub is down must not be lost. Needs a 01e addition. |
| F-8 | Volume assumption: ≈ 75 000 events/day/branch already (R6 as changed by 01d). | README R6 | Store must not add tens of thousands of raw sensor events; projection vs event split matters (topic 4). |

## 1. Decisions (S-G1-n)

| # | Decision | Trade-off accepted | Date |
|---|---|---|---|
| S-G1-1 | **Architecture: one platform, "Store first, POS plugs in"** (middle path between G0 option B and a POS-only first release). (a) Store depends only on the platform (00 hub, login, staff, PIN, devices; 01d alerts and requests; 01e devices), never on POS modules (01a menu / stations / business day, 02 orders, 08). (b) Store's ingredient list uses the **same ingredient tables** 08 will use, so a Store customer who later buys the POS keeps all data. (c) Expected usage comes through one **sales socket** ("how much of ingredient X should have been used between t1 and t2"): provider 1 = our POS (08 recipes × orders), built for the pilot; provider 2 = CSV upload of another POS's sales, built when the first outside buyer arrives (~1 week). (d) A tenant record lists the modules it bought; a module not bought is off. Standalone is a real product from day one: weights, sessions, door, camera and anomalies A1–A4, A6–A8 work without any POS; only A5 (recipe match) waits for the socket. | Store cannot reuse POS concepts (stations, business day): it needs its own open/closed store model. 01c's `stock_item_branches.station_id NOT NULL` must become optional (small 01c change, F-4). The CSV provider is gated, so an early outside buyer who wants A5 waits ~1 week. | 2026-11-02 |

## 2. Open items

| # | Item | For | Status |
|---|---|---|---|
| O-1 | G0 Q1–Q11 | this G1 | open |
| O-2 | **Record every stable step inside a session, not only the open → close difference.** The stone swap nets to zero between door open and door close; only the intermediate stable weights (2 400 → 1 400 → 2 400) show it. A jar lifted off its plate is a "lifted" state, not a weight change. | topic 3 (sensing), topic 4 (events) | proposed (spice-shelf dry run) |
| O-3 | Jars swapped between bins (mirch jar put on the zeera plate) look like two opposite changes; needs a rule (jar weight signature, or "both bins changed in one session and restore each other"). | topic 3 | open |
| O-5 | **Meat / chicken flow** (freezer dry run, proposed): receive (weigh vs order and invoice) → clean (yield vs expected range, per person on duty) → portion into labelled packs (id, item, weight, date, packed by) → freezer / chiller (door sensor + camera only) → issue by scanning labels and weighing at the issue station → blind daily pack count. Bulk storage without portioning is the cheaper fallback (weigh every issue, count by weight). Choice depends on the father's answer (§3). | topic 3, topic 6, 08 I13 / I14 / I15 | open |
| O-6 | Chicken (and some meat) arrives with ice or water in the crate; received weight must use crate tare and a drain rule, or the vendor's ice is paid as chicken. | topic 3, 10 | open |
| O-7 | Pack labels need a **label printer** (not the 03b receipt printer) or pre-printed QR stickers scanned by the tablet camera; to price in topic 2. | topic 2 | open |
| O-8 | **Pre-pilot hooks (proposed, developer asked 2026-11-02 "what do I change now?").** Rule: structure that real pilot data will freeze (tables, event payloads, device types, the device protocol) is decided before 2027-02-28 while R29 allows breaking changes; features wait. **Now, inside specs already planned:** (1) **08 spec:** ingredients as `stock_items` of kind `'ingredient'` with an optional station (01c `station_id NOT NULL` relaxed in the same breaking window), a storage location, pack units and density next to I3's units, stock movements whose source is an open list (`receipt`, `issue`, `count`, `wastage`, later `store_issue`), and expected usage between two times exposed as a contract (the S-G1-1 sales socket); I13's receiving scale is the same device and flow as Store's issue station. (2) **01e spec:** headless device types defined so that a new role (shelf controller, door kit, camera bridge, 09 gas pulse counter) is one more value in the same widening as `pager_bridge`, not a second 00 bump; the compact protocol gets an optional device-side buffer with its own sequence for measuring devices (09 G1 already needs it, O-4). (3) **10 spec:** V7 separation of duties covers the person who weighs a receipt. **Later, safe to add:** a `store` stream type (widening the Zod enum is additive; the events table has no CHECK on it), the Store module, licensing (milestone C), camera clips, the CSV connector. | 08, 01e, 10 specs | proposed, awaiting developer |
| O-4 | Shelf controller must buffer readings while the hub or Wi-Fi is down and send them with their own sequence on reconnect (F-7); conflicts with 01d G0 G4 "no queue on device". | topic 2, 01e additions | open |

## 3. Questions for the father / the restaurant

| # | Question | Why |
|---|---|---|
| QF-1 | How are mutton, beef, chicken and paye stored today: bulk in the freezer, or cut into portions first? Who cleans and who stores? | decides O-5 (portion packs or bulk) |
| QF-2 | How much meat, chicken and paye arrive per day / week at Lake City, from how many vendors, fresh or frozen, in crates or bags, with ice? | sizing, O-6 |
| QF-3 | Usual cleaning yield (10 kg raw mutton → ? kg usable; chicken; paye) as the chef sees it | expected yield range for alerts |
| QF-4 | Has short weight or extra ice in deliveries been seen before? With which items? | A8 thresholds, which items first |

## 4. Pilot shelf shopping list

(filled in topic 2)

## 5. Spec list this product needs

(filled at the end)

## 5a. Developer's model: store and kitchen stock (developer, 2026-11-03)

**As the developer sees it:** two places. **Inventory** = the store (godown): bulk, e.g. 10 kg of each masala, 50 packets. **Stock** = the day's working stock in the kitchen: e.g. 0.5 kg of each masala, 10 packets of tawa piece. Kitchen stock is used through the day; when it falls below a threshold the system says so and it is refilled from the store. **One person** whose job is to keep the daily stock is the one who goes to the store and brings it. Store weights are measured in real time, and an act is suspicious when the person went for X and other bins changed too.

**Naming clash (to settle):** in the specs "stock" already means **pre-cooked stock** (01a S45, `StockSet` / `StockAdded`, pots of paye ready to serve) and 01c `stock_items`. Proposed words: **Store** (godown, the developer's "inventory") and **Kitchen stock** (the developer's "stock"); Urdu UI may say *Godown* / *Kitchen*.

**Proposed workflow (Claude, for approval):**

| Step | What happens | Who | Data |
|---|---|---|---|
| 1 | Each item has, per kitchen, a **par** (target, 500 g) and a **threshold** (refill point, 150 g) | owner sets once | settings as data (R18) |
| 2 | Kitchen stock is known by **recipe usage** (08: orders × recipes) with the POS; standalone: the cook taps "low" or the keeper checks; kitchen bins later | system / cook | 08 depletion; no kitchen sensors in the pilot (heat, grease) |
| 3 | At fixed **refill rounds** (e.g. 11:00 before lunch, 17:00 before dinner) the system builds a **refill list**: every item below threshold, quantity = par − current | system | 01d action alert to the stock keeper |
| 4 | Only the **stock keeper on duty** can open the store (door kit: RFID or PIN; permission `refill-kitchen-stock`); anyone else, including a manager, opens only with a reason and is flagged | stock keeper | session with purpose = refill list #n |
| 5 | Store bins drop; each drop is matched to the list (item and quantity, ± tolerance) | system | store events (topic 4) |
| 6 | Kitchen receives: the cook confirms on the tablet (or the jar is weighed at the issue station) | cook | transfer store → kitchen (08 I5) |
| 7 | Between rounds a cook needs more: **request** on the tablet → approved by the manager (or auto within par) → keeper fetches | cook, manager, keeper | 01d request kind |

**Suspicious, in real time (store side):** a bin changed that is not on the list or request (A1); more than listed (A6); drop then return in one session (A2); store opened outside a round with no request, or by someone who is not the keeper; a change with no session (A3). **Over days (kitchen side):** refills into the kitchen larger than recipe usage says it needed → the leak is between store and kitchen, or in the kitchen (by shift and person on duty, 08 I16).

## 6. Dry runs per item type (developer asked, 2026-11-02)

Illustrative walk-throughs to fix the mental model. Every number is an example; tolerances are **placeholders** until topic 2 (hardware research) and topic 3 (sensing rules) set them. Everything here is configuration (R18): adding a shelf, a bin or an item is pairing and mapping, never code.

### 6.1 Building blocks

| Block | What it is | Configured as data |
|---|---|---|
| **Item** | an ingredient: name, **stock unit** (g, ml or piece), optional **pack** (a purchase / count unit with its weight: tin 16 kg, sack 50 kg, packet 200 g, tray 30 eggs), optional **density** for ml items weighed in g | item list (shared with 08, S-G1-1 b) |
| **Bin** | one weighing spot: S (jar, ≤ ~5 kg), M (tin, ~30–50 kg), L (floor, ~100–150 kg); tare, capacity, tolerance | bin map: shelf, position, size, item |
| **Item ↔ bins** | an item can sit in **several bins** (3 zeera jars, 2 aata sacks); item stock on shelves = sum of its bins | many bins → one item |
| **Reserve** | closed stock not on a scale (sealed tins, sacks in the back); counted in packs, changes only by receipt, refill or count | per item, in packs |
| **Issue station** | tablet + bench scale + camera at the door; weighs anything not on a bin (meat, chicken, paye, dairy, a one-off) | one per store |
| **Session** | door opened by a person (RFID / PIN) for a reason (an approved issue request, a refill, a receipt, a count) until the door closes | — |
| **Shelf controller / door kit / camera** | ESP32 devices paired from the app (display code or setup page), then mapped; replace = pair the new one, re-map | device list |

### 6.2 Walk-throughs

| # | Item (unit) | Where it sits | Normal flow | Theft case | What catches it |
|---|---|---|---|---|---|
| D1 | **Laal mirch** (g) | S bin, 2 kg jar (tare 400 g) | Hamza requests 500 g → manager approves (01d request) → Hamza opens with RFID → bin 2 000 → 1 500 g, stable → matches request (±10 g) → issue recorded, session closed | Requested namak; takes 1 000 g mirch and puts back a 1 000 g stone in the same session | bin not in request (A1) + drop then return (A2) → manager alert with clip; later recipe match shows mirch not falling (A5) |
| D2 | **Zeera** (g), store grows | 3 jars on 3 S bins, same item | Item total = 3 bins; a request can be filled from any jar; the drop is matched per item, not per bin | Small pinches every day (20 g) under the tolerance | daily trend per bin vs sensor drift (A7) |
| D3 | **Zeera refill** | 5 kg bag from reserve → jars | Refill session: reserve −1 bag, jars +5 000 g total | Refill jar with cheaper filler | bin rose with **no refill / receipt** → anomaly; with a refill, jars +5 000 but reserve count says no bag left → mismatch; A5 later |
| D4 | **Ghee** (g; tin 16 kg) | open tin on M platform; sealed tins in reserve | Cook takes 2 kg in a jug → M drops 2 000 g ± 50 g → matched | Water added to the tin to hide 1 kg taken | weight alone is beaten here; A2 if in one session; A5 recipe match over days; tin replaced early (reserve −1 too soon) |
| D5 | **Cooking oil** (ml in recipes; weighed in g) | 16 L tin on M platform | Weighed in g, shown in L with density (~0.92, set per item) | as ghee | as ghee |
| D6 | **Aata** (g; sack 50 kg) | up to 2 sacks on an L floor platform | Kitchen takes 10 kg → platform −10 000 g ± 200 g → matched | Full sack swapped for a sack of sand (same weight) | **weight cannot see it**: camera clip of every session that touches L platforms; A5 recipe match; delivery weighed at receipt (A8) |
| D7 | **Chawal / cheeni** (g; sack 25–50 kg) | as aata | as aata | as aata | as aata |
| D8 | **Packets** (piece; Shan masala 50 g, zafran 200 g pack) | box on S bin; pack weight set | Drop of 400 g = 2 packets of 200 g | One packet opened, half taken, put back | drop not a whole number of packets (e.g. 1.5) → anomaly |
| D9 | **Eggs** (piece; tray of 30) | trays on S/M bin | Drop ≈ 600 g → "about 10 eggs" | Few eggs a day | **count by weight is approximate** (egg weight varies); issue by whole trays or count at issue station |
| D10 | **Mutton / beef** (g) | freezer / chiller: **no load cells inside** (G0 §5) | Delivery weighed at the issue station (vs order and invoice, A8) → cleaning yield recorded (I14) → packed into labelled portions (e.g. 1 kg, with id and weight) → chef requests 3 kg → 3 labelled packs weighed out at the issue station → issue recorded | Freezer opened at night; short delivery; portion packs lighter than the label | freezer door sensor + camera (A3 / A4); delivery below invoice (A8); random re-weigh of packs; blind daily count of high-value items (I15) |
| D11 | **Chicken** (g) | chiller crates, often fresh daily | as D10, but daily delivery and faster turnover; yield after cleaning (skin, bones) | short-weight delivery (most common) | weighed at receipt (A8); yield per person on duty (I14) |
| D12 | **Paye** (piece and g) | chiller / freezer | delivered by count **and** weight; cleaning yield; issued per degh batch (08 batch recipe) | count short at delivery; pieces missing between delivery and degh | count + weight at receipt; degh batch draws vs issued pieces |
| D13 | **Dahi / milk** (g or ml) | chiller | issued by weight at the issue station | — | issue records + A5 |

### 6.3 Store size, same software

| Store | Kit |
|---|---|
| Small | issue station + door kit + camera + 4–8 S bins (costliest spices) |
| Medium | + 1–2 shelves of S bins, 2–4 M platforms (ghee, oil) |
| Large | + 3+ shelves, L floor platforms (sacks), freezer / chiller door kits, second camera |

### 6.4 Honest limits shown by the dry runs

1. **Same-weight swaps of a whole container** (sand in an aata sack, water in ghee) are invisible to weight; only the camera clip, the request match and recipe match (A5) catch them. Camera is required, not optional (G0 risk 5).
2. **Meat and chicken are controlled at the issue station and at receipt, not on shelves.** Freezer load cells are not used.
3. **Piece counts by weight** are exact only for uniform packs; eggs and paye are approximate.
4. **Reserve stock** (sealed tins, sacks) is only as good as receipts and counts; it has no sensor.
