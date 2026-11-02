# Product roadmap — must-have modules not yet in a spec

| | |
|---|---|
| Status | **Proposed — needs approval** (developer, 2026-11-02). A record so these requirements stop living only in chats. Each module gets its own G0 → spec pipeline; nothing here changes an approved spec. |
| Why | The owner (Arif Chatkhara) needs the numbers: what each dish costs, where stock goes, where gas goes, who and which station is slow. These are must-haves for the product, not extras. |
| Sources | README R28 (recipe inventory module, approved with 01c v1.0); `stories-refined.md` P2 "Ingredient-level inventory", "Daily closing summary", "End-of-day wastage log", "Promised vs actual time", "Table turn time, peak hours, staff performance"; 01d G0 K11–K13, Z1–Z8, G0-8; 03a G0 D19–D21; developer chats 2026-10-30/31 (gas metering), 2026-11-02 (inventory depth). |

---

## Sequence (proposed)

01d (closing) → 01a v2.1 → 03a → 02 → 04 → 03b → 05 → **08 Inventory & Costing** → 06 backup → 01e Device gateway (+ **09 Gas** sensors in the same ESP32 family) → 07 Owner / manager view → soft pilot → full pilot (2027-02-28).

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

**Long pole is data, not code:** every recipe (100+ items, variants, modifiers) must come from the chef and the owner. Start collecting now in a simple sheet: item · variant · ingredient · quantity · unit · notes.

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
| 08 | I1–I11 (recipes, units, depletion, purchases, POs, forecast, costing, where-used, what-if, variance) | I12 trends, multi-branch transfers if not needed at Lake City |
| 09 | G1 on the tandoor only, G2, G4, G5 | G1 other stations, G3 full allocation, G6, G7, G8 |
| Stats | S1, S6, S7 basic | S2–S5 reports, S8 |

## Data to collect now (no code needed)

1. Recipes for every item (sheet above), with the chef.
2. Supplier list: who supplies what, how often, how paid.
3. Burner ratings (kW or m³/h) at every station, from the plates or a gas fitter.
4. Gas setup per branch: Sui gas or LPG, cylinders per week, current bills.
