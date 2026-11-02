# Product roadmap — must-have modules not yet in a spec

| | |
|---|---|
| Status | **Proposed — needs approval** (developer, 2026-11-02). A record so these requirements stop living only in chats. Each module gets its own G0 → spec pipeline; nothing here changes an approved spec. |
| Why | The owner (Arif Chatkhara) needs the numbers: what each dish costs, where stock goes, where gas goes, who and which station is slow. These are must-haves for the product, not extras. |
| Sources | README R28 (recipe inventory module, approved with 01c v1.0); `stories-refined.md` P2 "Ingredient-level inventory", "Daily closing summary", "End-of-day wastage log", "Promised vs actual time", "Table turn time, peak hours, staff performance"; 01d G0 K11–K13, Z1–Z8, G0-8; 03a G0 D19–D21; developer chats 2026-10-30/31 (gas metering), 2026-11-02 (inventory depth). |

---

## Sequence (proposed)

01d (closing) → 01a v2.1 → 03a → 02 → 04 → 03b → 05 → **08 Inventory & Costing** + **10 Vendor payments** → 06 backup → 01e Device gateway (+ **09 Gas** sensors in the same ESP32 family) → 07 Owner / manager view → soft pilot → full pilot (2027-02-28).

Milestone A's module list (README) gains 08, and 09's pilot form (below), only after this file is approved.

---

## 08 Inventory & Costing (deep)

Extends R28's scope with purchasing, costing and impact analysis.

| # | Requirement | Notes |
|---|---|---|
| I1 | **No recipe → not on the menu.** An item can't be put on sale until its recipe (ingredients + quantity) is attached. | R28 setting `block / warn / off`; Arif Chatkhara wants **block** |
| I2 | **Recipe / BOM per sellable item**, per variant, with modifier deltas (extra cheese adds X g), deal parts, **sub-recipes** with yield (masala, gravy base), **batch recipes** for degh items (paye, chanay) with portions per batch | 01c hooks: variant `item_id`, stable option / part ids, `ItemAdded` carries options and draws |
| I3 | **Unit-level measuring** with three units per ingredient: purchase (50 kg bori, 16 L tin), stock (kg, L), recipe (g, ml, piece), and conversions | |
| I4 | **Depletion from orders** (theoretical use), reversed on void (04), plus wastage and staff meal | |
| I5 | **Stock movements:** purchase receipt, transfer between branches / central kitchen, adjustment, count | |
| I6 | **Suppliers and purchase orders:** supplier list, PO, receive against the PO (short / extra), price history per supplier | |
| I7 | **"About to run out" before it happens:** usage rate from the last days → days of cover ("Aata: 3 days left"), reorder point, suggested PO quantities | low-stock alert through 01d (info kind) |
| I8 | **Costing:** ingredient cost (latest and weighted average), recipe cost per item / variant / modifier, food cost %, margin per item | |
| I9 | **Where-used:** for any ingredient, every item, sub-recipe and deal that uses it, and how much per day / month | |
| I10 | **What-if / impact:** "ghee 10 % cheaper" or "new supplier at Rs X" → new cost and margin of every affected item and the monthly saving at current sales | key decision tool for the owner |
| I11 | **Theoretical vs actual variance:** daily / shift counts against depletion; missing stock by ingredient and value | |
| I12 | **Vendor short-fill:** received weight vs ordered, per supplier, as a trend | links to 09 (LPG) |

**Further inventory features (developer proposals, 2026-11-02):**

| # | Feature | Why |
|---|---|---|
| I13 | **Weighed goods receipt:** a scale at the store (USB or ESP32 load cell) captures the weight of every delivery, with a photo; received vs ordered vs invoiced | short supply is caught at the door, not at month end |
| I14 | **Butcher / cleaning yield:** raw in (10 kg mutton) → usable out (7 kg); actual vs expected yield per ingredient and per person on duty | the most common hidden loss on meat |
| I15 | **High-value daily count (80/20):** a short daily count of only the top ~10 costly items (meat, ghee, oil), by someone other than the store keeper; blind (the counter doesn't see the expected figure) | full counts are skipped in practice; this one gets done |
| I16 | **Variance by shift and by who was on duty** | turns "stock is missing" into "it goes missing on the night shift" |
| I17 | **Price watch:** price history per ingredient and supplier; alert when a price jumps vs the last purchase or another supplier | inflated prices are part of most purchase fraud |
| I18 | **Food cost guard:** when an ingredient price rise pushes an item's food cost above its target %, alert to reprice | margin protection |
| I19 | **Menu engineering:** popularity × margin (stars, plough-horses, puzzles, dogs) per item | what to push, reprice or drop |
| I20 | **Expiry and FIFO** batches for perishables (dairy, meat) with expiry alerts | waste |
| I21 | **Prep / par forecast by day of week and season** (weekend, Ramadan, Eid): how much to prep and how big tomorrow's paye degh | links 03a stock and pre-cooked stock |
| I22 | **Supplier scorecard:** on time, short-fill %, price changes, rejects | which vendor to keep |
| I23 | **Wastage and staff meal with reason and photo** | separates real waste from theft |
| I24 | **Dead and slow stock** | cash stuck on shelves |

**Long pole is data, not code:** every recipe (100+ items, variants, modifiers) must come from the chef and the owner. Start collecting now in a simple sheet: item · variant · ingredient · quantity · unit · notes.

---

## 10 Vendor payments and payables (anti-fraud)

**The loss that drives it (owner, ~Rs 5 million):** vendors are paid in part payments. A manager wrote "paid in full" in the khata but paid the vendor less and gave him a slip for the smaller amount. Months later the vendor claimed the balance with valid slips. Manager and vendor are believed to have colluded. It can happen at any branch.

**Root cause:** one person recorded the payment, held the cash and kept the only proof; the vendor never confirmed anything at the time; the proof was paper.

**Principle:** every payment is confirmed by the vendor at the moment it happens, the money leaves through a trail the manager doesn't control, and the owner sees every vendor balance live.

| # | Control | How it stops the fraud |
|---|---|---|
| V1 | **Vendor ledger in the POS, no paper khata.** Every delivery (goods receipt, I5 / I13) and every payment is a record with who, when, how, proof | one source of truth across branches |
| V2 | **Vendors are created only by the owner**, with a verified phone number and bank account (owner calls once to confirm) | no fake vendors, no changed account numbers |
| V3 | **Instant vendor confirmation:** at every payment the vendor gets a message (SMS / WhatsApp) from the restaurant's number: "Rs 50,000 paid by Arif Chatkhara Lake City (Imran), 2 Nov 3:40 PM. Your balance: Rs 20,000. Wrong? Call {owner}". Monthly statement to every vendor too | the manager can't record more than he paid without the vendor seeing it the same minute |
| V4 | **Written vendor terms, signed by the owner:** payments are confirmed by message; disputes within 7 days, else the confirmed balance stands | removes the scheme's payoff: a colluding vendor can't claim a balance months later against confirmed payments |
| V5 | **Bank / Raast payments above a threshold, from the owner's account.** The manager raises a payment request (01d request kind, PIN); the owner approves; the owner or accountant pays; the bank reference is attached | the bank statement is independent proof; the manager never holds large cash |
| V6 | **Cash payments (below the threshold) need two people** (manager + cashier PINs) and a photo of the vendor's signed, numbered receipt, captured in the app | no single person can pay and record |
| V7 | **Separation of duties:** the one who orders ≠ the one who receives (weighs) ≠ the one who pays | collusion now needs three people |
| V8 | **Auto-reconciliation:** vendor statements matched against the ledger; any gap goes to the owner, not the manager | |
| V9 | **Red flags to the owner:** paid ≠ invoiced, many small partial payments, a vendor balance growing month on month, payments outside hours, a price above the price watch (I17), received weight below invoiced (I13) | |
| V10 | **Owner's live payables view** across branches: what each vendor is owed, every payment with method, approver and proof | the owner checks in a minute instead of finding out after months |

Notes: messages need the cloud (queued while the hub is offline, sent when it reconnects); WhatsApp Business API or an SMS gateway is a paid service to choose at spec. No control is perfect against an owner who never looks; V3 + V4 + V5 make the fraud both visible and unprofitable.

---

## 09 Gas and utilities monitoring

From the developer chat of 2026-10-30/31. Hardware is optional for other customers (H0); Arif Chatkhara runs it.

| # | Requirement | Notes |
|---|---|---|
| G1 | **Per-station gas sub-meter:** diaphragm meter with pulse output (reed switch) + ESP32 pulse counter (same device family as 01e), on the biggest users first: tandoor, degh burner, karahi range; the rest on one common meter | meter size from each burner's rating (G4 / G6 / G10); pulses saved to flash; offline buffering; sent to the hub on the LAN |
| G2 | **LPG cylinders:** a load-cell scale at delivery; actual gas = weight − tare (commercial 45.4 kg, domestic 11.8 kg); logged with the delivery | catches short-filled cylinders (happened at Lake City) |
| G3 | **Gas cost per dish:** station gas per hour × tariff, allocated to what that station made in that hour; batch items share their batch's gas | completes recipe costing (08 I8) |
| G4 | **Idle burn alert:** gas flowing at a station with no orders for N min → "Tandoor burning idle for 40 min" | staff waste |
| G5 | **Night baseline:** gas flowing while the restaurant is closed → leak or theft alert | a past line tap went unnoticed for years |
| G6 | **Balance check:** main meter minus all sub-meters; a growing gap means gas going elsewhere | main meter read without contact (ESP32-CAM photo of the dial) — confirm SNGPL rules first |
| G7 | **No-hardware mode** for other customers: the owner enters the monthly gas bill; it is allocated by station cooking time | |
| G8 | **Reports:** gas per station, per shift, per dish; idle hours; vendor short-fill % | |

**Safety, non-negotiable:** never touch the Sui gas company's main meter; sub-meters only on internal lines after it; installation by a licensed gas fitter with a leak test; a gas leak detector in the kitchen.

**Pilot form (proposed):** one meter on the tandoor + the LPG delivery scale, two weeks of data, then decide on the other stations.

---

## Stats and analytics (07 + reports)

Most data is already captured by 01d / 02 / 03a / 03b events (K11). This module makes it visible.

| # | Stat |
|---|---|
| S1 | Manager live view (G0-8): needs-attention list, points and stations strip, people load, today's money |
| S2 | Kitchen / assembly / pickup / return times as expected · actual · extra, per station, point, zone, person (K11) |
| S3 | Per-waiter and per-chef speed split by load at that moment; share of the team's work (K12) |
| S4 | Station pressure history, peak hours, overload events (03a D20) |
| S5 | Promised vs actual time, table turn time |
| S6 | Voids, discounts, comps by person, approver and method (in person / requester's device) |
| S7 | Food cost %, margin, variance (08), gas cost (09) |
| S8 | Daily closing summary on WhatsApp / email to the owner |

---

## Pilot scope (to decide with the owner)

| Module | Proposed for the pilot | After the pilot |
|---|---|---|
| 08 | I1–I11 (recipes, units, depletion, purchases, POs, forecast, costing, where-used, what-if, variance), I13, I15, I16, I17 | I12, I14, I18–I24, multi-branch transfers if not needed at Lake City |
| 10 | V1–V7, V10 | V8, V9 automation (manual owner check until then) |
| 09 | G1 on the tandoor only, G2, G4, G5 | G1 other stations, G3 full allocation, G6, G7, G8 |
| Stats | S1, S6, S7 basic | S2–S5 reports, S8 |

## Data to collect now (no code needed)

1. Recipes for every item (sheet above), with the chef.
2. Supplier list: who supplies what, how often, how paid.
3. Burner ratings (kW or m³/h) at every station, from the plates or a gas fitter.
4. Gas setup per branch: Sui gas or LPG, cylinders per week, current bills.
