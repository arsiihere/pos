# 07 — Owner View: screen inventory

**No spec yet.** Sources: D22 / foundation §3.6 (P1 basic remote owner view: read-only, per branch and combined), §6.5 (owner WS `update` messages), stories E0-REP AC1–4 (sales and tax report, viewable remotely through the P1 owner view), E0-BAK AC4, E5-OFF AC5 (sync status), E8-TAX AC3; README R10, 01/07 carried (owner lockout notice). P2 dashboards (promised vs actual, learned cook times, daily summary) are out of scope. Conventions in [00-index.md](00-index.md).

---

## 1. Who and where
| Who | Device | Network | How often | Conditions |
|---|---|---|---|---|
| Owner (and partners owning some branches; `allowed_branch_ids`); `view-reports` for others (Q1) | Owner phone 390 (OP) first — checks from home/car; laptop (L) | Internet, cloud `wss://…/v1/owner/live` | Several times a day; every night after close | Read-only (D22); never touches a hub |

## 2. Jobs to be done
| # | Job | Story AC | Acceptance |
|---|---|---|---|
| J1 | As the owner, I need today's sales, order count and payment-mode split per branch and combined. | D22; F §3.6 | live from cloud projections |
| J2 | As the owner, I need void and discount counts and values. | D22 | per branch and combined |
| J3 | As the owner, I need each hub's sync status and last backup time, with an alert when no backup in > 24 h. | E0-BAK AC4; E5-OFF AC5 | last synced seq/time |
| J4 | As the owner, I need a sales report filterable by date range, branch, item, category, hour, staff, order type, payment mode. | E0-REP AC1, AC3, AC4 | read-only |
| J5 | As the owner, I need a tax report (gross, tax by class, net) for manual filing. | E0-REP AC2; E8-TAX AC3 | closed bills in a range |
| J6 | As the owner, I need to be told my login was locked. | 00 M73 carried (01/07) | notice on next login |

## 3. Screen list
| ID | Name | Kind |
|---|---|---|
| 07-S01 | Sign in (reuses 01a-S01) | screen |
| 07-S02 | Today — all branches (combined + one card per branch: sales, orders, payment split, voids, discounts, sync, last backup, alerts) | screen |
| 07-S03 | Branch detail (same figures, one branch, hour chart) | screen |
| 07-S04 | Sales report (filters + table/chart) | screen |
| 07-S05 | Tax report | screen |
| 07-C01 | Date range picker (today, yesterday, this week, custom; business days vs calendar — Q2) | component |
| 07-B01 | Live / reconnecting indicator | status chip |
| 07-B02 | Alerts: no backup in 24 h, backup failed, hub not synced for N h, clock alarm | banner list |
| 07-B03 | Owner lockout notice (shared with 01b-B01) | banner |
| 07-B04 | "Figures up to 13:05 — Gulberg hub offline since 12:40" (stale data) | inline note |

**Count: 10.**

## 4. Per screen

### 07-S02 Today — all branches
- **Layout (phone first):** header (date, live chip B01) → B02 alerts → combined card: Sales Rs 4,82,350 (note: Pakistani grouping 4,82,350 vs 482,350 — Q3), Orders 1 742, Cash/Card/Online split, Voids 14 · Rs 9,800, Discounts 22 · Rs 6,400 → branch cards (Gulberg, Johar Town): same + "Synced 13:05 · Backup 04:00 ✓" → tap → S03.
- **Data:** cloud projections via REST + `wss` `update { resource: 'branch_summary', branch_id, data }`. Money from `_minor`, LTR.
- **States:** loading; no data today ("No sales yet today"); stale branch (B04); reconnecting (B01); token expired → refresh → sign in; network.

### 07-S04 Sales report
Filters (E0-REP AC1): date range (C01), branch, item, category, hour of day, staff, order type, payment mode → results: totals + table (group by chosen dimension) + simple bar by hour. No export in P1 (CSV/Excel is P2, E0-REP out of scope). Read-only.

### 07-S05 Tax report
Range + branch → gross sales, tax by class (PRA cash 16 %, PRA card 5 %), net; "for manual filing". Print/save? (Q4).

## 5. Flows
1. **Night check (phone):** 07-S01 → S02 → Gulberg → S03 hour chart. Unhappy: Gulberg backup failed → B02 → (no action in P1; call manager).
2. **Monthly tax:** S05 → last month → read figures.

## 6. Data shown
Branch summaries (sales_minor, order_count, by payment mode, void_count/value, discount_count/value, last_synced_seq/at, last_backup_at), report rows. Source: cloud projections of synced events — figures lag while a hub is offline.

## 7. Cross-module links
Needs 05 (bills, payments, Z report), 04 (voids), 06 (sync, backups), 01b (branch names). Uses 01a-S01 login and owner app shell.

## 8. Open questions (owner)
- **Q1** Can a manager (staff with `view-reports`) open the owner view? It is a cloud email login today.
- **Q2** "Today" = calendar day or business day (open → close, can run past midnight)?
- **Q3** Number grouping: 4,82,350 (lakh) or 482,350?
- **Q4** Should reports be printable/saveable in P1 (export is P2)?
- **Q5** Which alerts matter most at night (backup, sync, clock, unusual voids)?

## 9. Design status
Not designed.

## Story AC → screen IDs
| Story AC | Screens |
|---|---|
| D22 (sales, voids, discounts, modes, sync, backup) | 07-S02, S03 |
| E0-REP AC1 | 07-S04 |
| E0-REP AC2; E8-TAX AC3 | 07-S05 |
| E0-REP AC3 (remote) | 07-S02–S05 |
| E0-REP AC4 (read-only) | all 07 screens |
| E0-BAK AC4 | 07-S02, B02 |
| E5-OFF AC5 (owner side) | 07-S02, B04 |
| M73 lockout notice | 07-B03 |

**ACs with no screen:** none.
