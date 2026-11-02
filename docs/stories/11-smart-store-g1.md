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
| — | (none yet) | | |

## 2. Open items

| # | Item | For | Status |
|---|---|---|---|
| O-1 | G0 Q1–Q11 | this G1 | open |

## 3. Questions for the father / the restaurant

(filled during G1)

## 4. Pilot shelf shopping list

(filled in topic 2)

## 5. Spec list this product needs

(filled at the end)
