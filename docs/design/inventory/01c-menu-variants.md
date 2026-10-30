# 01c — Menu: variants, modifiers, deals — screen inventory

**No spec yet.** Sources: README module map row 01c and carried requirement (01c row), 01a §12.5 (01c scope list), 01a §4.4, stories E0-MENU AC4–6 and edge cases, E1-ROUTE AC3 and edge cases, D25. Written **after 01a and before 02**, because it shapes the order line. API names are **proposed**. Conventions in [00-index.md](00-index.md).

---

## 1. Who and where
| Who | Device | Network | How often | Conditions |
|---|---|---|---|---|
| Owner (tenant-wide edit: owner covering every branch, `can_edit_tenant`, S8) | Laptop (L), phone (OP) | Cloud owner app, internet | Setup: ~20 variant items (half/full karahi, small/large lassi), ~10 modifier groups, ~10 deals; then monthly (new deal) | Calm |
| Order taker (sees the result) | — | — | — | screens are 02-D03 / 02-D04 |
| Cook (sees deal parts, not the deal) | — | — | — | 03b |

## 2. Jobs to be done
| # | Job | Story AC | Acceptance |
|---|---|---|---|
| J1 | As the owner, I need variants on an item (half/full, small/large, quarter) each with its own price, and its own cook time, station and stock where they differ, so that the kitchen and bill are right. | E0-MENU AC4; E1-ROUTE AC3 | variant overrides price, cook time, station; station must be configured (edge) |
| J2 | As the owner, I need items sold by weight (karahi per kg) so that the waiter types 1.5 kg. | 01a S44, §12.5 "weighted items" | sale unit g/ml; price per kg/L; line through `lineTotalMinor` |
| J3 | As the owner, I need modifier groups (extras, sides) with paid or free options and min/max choices, attached to items or categories, so that orders are complete. | E0-MENU AC5; 01a §12.5 | zero-price option valid (edge); option may change station |
| J4 | As the owner, I need deals/combos with one price, each part routed to its own station, so that the kitchen sees parts and the bill shows one line. | E0-MENU AC6; 01a §12.5 | combo shown as one line at ordering; unavailable part ⇒ deal unavailable (edge) |
| J5 | As the owner, I need variants that share one stock pool (half and full karahi from one pot) so that the count is right. | 01a carried (stock pools are 01c's) | pool in a stock unit; each variant consumes N units |
| J6 | As the owner, I need serve mode overridable per modifier so that a side can come immediately. | E1-ROUTE AC1 ("can be overridden per modifier") | immediate / together |

## 3. Screen list
| ID | Name | Kind |
|---|---|---|
| 01c-S01 | Item form — Variants section (extends 01a-S07) | section |
| 01c-D01 | Retired by spec V2 — a size is a full item (01a-S07 + 01c-S01). | — |
| 01c-S02 | Modifier groups list | screen |
| 01c-S03 | Modifier group form (name, min/max, options with price/free, station/cook overrides, serve mode, attached to items/categories) | screen |
| 01c-D02 | Attach group to items / categories picker | dialog |
| 01c-S04 | Deals list | screen |
| 01c-S05 | Deal form (name, price, category, hours, parts: item/variant, quantity, choices) | screen |
| 01c-D03 | Add deal part picker | dialog |
| 01c-S06 | Stock pools (shared stock for variants) | screen or item-form section |
| 01c-B01 | Override validation ("Choose a station that cooks at Gulberg") | inline error |
| 01c-B02 | Stock page rows for pools (extends 01a-S11) | row variant |

**Count: 10** (01c-D01 retired, designer decision 2026-10-30).

## 4. Per screen

### 01c-S01 Variants
| Label | Type | Validation | Default | API (proposed) | LTR |
|---|---|---|---|---|---|
| Variant name | text | 1–30, unique within item | — | `variants[].name` ("Half", "Full", "Quarter", "Small 250 ml") | — |
| Price | rupees | as 01a price | item price | `price_minor` | yes |
| Cook time (if different) | minutes | 1 min–4 h | item's | `cook_time_ms` | yes |
| Station at each branch (if different) | station picker per branch | configured, active, same branch (edge) | item route | route override | — |
| Uses from stock | quantity in pool unit (e.g. 500 g for half, 1 000 g for full) | ≥ 1 | — | `stock_per_sale_unit` per variant | yes |
| Sort number | integer | — | 0 | `sort_order` | yes |
- Replaces or keeps 01a's `group_label` (S12) — Q1. **Sample:** Chicken Karahi: Half Rs 1,150 (500 g), Full Rs 2,200 (1 kg); Lassi: Glass 300 ml Rs 250, Jug 1 L Rs 750. Weighted alternative: "Karahi by weight" sold per kg.

### 01c-S03 Modifier group form
| Label | Type | Validation | Default | API (proposed) |
|---|---|---|---|---|
| Group name | text 1–40 | unique | — | `name` ("Extras", "Choose your bread", "Spice level") |
| Customer must choose at least / at most | two numbers | 0 ≤ min ≤ max ≤ options | 0 / 1 | `min_choices`, `max_choices` |
| Options: name, price (0 = free), station override, cook time add, serve mode | repeatable rows | price ≥ 0; station configured | free | `options[]` |
| Applies to | items and/or categories (01c-D02) | ≥ 1 | — | attachments |
- **Sample:** "Bread with karahi" min 0 max 3: Naan Rs 30 (station Tandoor), Roghni naan Rs 60, Tandoori roti Rs 20; "Spice level" min 1 max 1: Mild, Medium, Hot (free); "Extra raita" Rs 80; "Extra napkins" Rs 0.

### 01c-S05 Deal form
| Label | Type | Validation | API (proposed) |
|---|---|---|---|
| Deal name | text 1–60 | unique | `name` ("Family karahi deal") |
| Deal price | rupees | ≥ 0 | `price_minor` |
| Category, tax, hours | as 01a item | — | — |
| Parts | rows: item or variant, quantity, optional "customer picks from" group | ≥ 2 parts; each part's own route/cook time/stock | `parts[]` |
- **Sample:** Family karahi deal Rs 3,200 = Full chicken karahi + 4 naan + 1 L lassi jug; kitchen sees "Karahi (full)" at Karahi counter, "Naan ×4" at Tandoor, "Lassi jug" at drinks.
- **States (all forms):** as 01a forms (busy, slow, name taken, reference invalid, read-only, network, idempotency mismatch).

### 01c-S06 Stock pools
Pool name, stock unit, members (variants and how much each uses). Stock page row shows the pool once (01c-B02: "Karahi pot 6 kg · Half uses 500 g · Full 1 kg"). Q2.

## 5. Flows
1. **Add Half/Full karahi:** 01a-S07 Chicken Karahi → Variants → Add Half (Rs 1,150, 500 g) → Add Full (Rs 2,200, 1 kg) → Save. Unhappy: variant station override points to an archived station → B01.
2. **Bread extras:** S02 → New group → options → attach to category Karahi → Save. Ordering sees it on 02-D03.
3. **Deal:** S04 → New → parts → Save. Unhappy: a part is archived → reference invalid; a part sold out → deal shows "Sold out" on 02-S05 (E0-MENU edge).

## 6. Data shown
Variants, modifier groups, options, deals, parts, pools — all inside the branch config snapshot (schema-1 additive or a coordinated new version, S28) consumed by 02.

## 7. Cross-module links
- **Needs:** 01a items, routes, units (S44), stock (S14, S41), windows (S47), `lineTotalMinor`.
- **Gives:** what 02's order line copies (D25): variant, chosen options, deal parts — each with name, price, tax class, station, cook time, serve mode, programs. 03a plans each part; 03b prints parts and modifiers on tickets (E0-TPL AC2); 05 bills the deal as one line.

## 8. Open questions (owner)
- **Q1** Replace 01a's "Group label" with real variants, or keep both?
- **Q2** Which items share a pot (karahi half/full; paye single/double)? Does each variant have its own count or one pool?
- **Q3** Can a deal part be swapped (e.g. roti instead of naan)? Price effect?
- **Q4** Are variants the same at all three branches (01a owner question 5)?
- **Q5** Should a modifier be able to make an item "together"/"as soon as ready" (E1-ROUTE AC1 says yes), and does a deal have its own serve mode?
- **Q6** Is an item's image (E0-MENU AC2) needed for variants/deals on the ordering screen?

## 9. Design status
Not designed. Extends 01a-S07 (itself awaiting redesign).

## Story AC → screen IDs
| Story AC | Screens |
|---|---|
| E0-MENU AC4 (variants override price, cook time, station) | 01c-S01 |
| E0-MENU AC5 (add-ons: price, station) | 01c-S03 |
| E0-MENU AC6 (combos, one line) | 01c-S05; 02-S05 shows the line |
| E0-MENU edge: unconfigured station | 01c-B01 |
| E0-MENU edge: combo with unavailable item | 02-B05 |
| E0-MENU edge: zero-price add-on | 01c-S03 |
| E1-ROUTE AC3 (modifier overrides) | 01c-S03, S01 |
| E1-ROUTE AC1 (serve mode per modifier) | 01c-S03 |
| E1-ROUTE edge (modifier to unconfigured station) | 01c-B01 |
| 01a carried: stock pools | 01c-S06, B02 |

**ACs with no screen:** none.
