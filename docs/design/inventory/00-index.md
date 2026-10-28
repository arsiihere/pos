# Screen inventory — index

A module-by-module list of every screen, dialog, banner, notification and printed layout the POS needs, written so a designer can design each one without guessing. Read-only research of 2026-10-26 (branch `module-01`).

**Sources, in order of authority:** `docs/specs/00_Foundation_Spec_v1.7.md` (F), the module specs `00_Hub_Platform_Access_Spec_v1.2.1.md` and `01_Restaurant_Setup_Spec_v1.0.2.md`, `docs/specs/README.md` (module map, R1–R20, carried requirements), `docs/stories/stories-refined.md` (for modules with no spec), `docs/design/ui-brief.md`, `docs/design/ui-brief-01a.md`, `packages/ui-kit/README.md`, and the code in `apps/client/src/**` and `apps/hub/src/**`. Spec wins over stories; code is checked for what exists today. `docs/design/01a-redesign/ui-redesign-01a.md` (named in the task) **does not exist**, and **no canvas or frame names are recorded anywhere in the repo**, so "Design status" below can only say whether a brief or built page exists.

**Not decided here.** Modules 01c, 02, 03a, 03b, 04, 05, 06 and 07 have no spec yet (01b's file follows its approved spec v1.0). Their API names are marked *proposed* and their open questions are owner questions; their specs may change these screens. Nothing here is a spec.

---

## Modules

| Module | File | Spec status | Screens | Designed |
|---|---|---|---|---|
| 00 Hub Platform & Access | [00-hub-access.md](00-hub-access.md) | v1.2.1 approved, built | 31 | 15 built and kit-styled (00 v1.2); 16 not designed (admin lists, global states) |
| 01a Restaurant Setup | [01a-setup.md](01a-setup.md) | v1.0.2 approved, built | 26 | all built with kit classes; full brief exists; redesign **not done**; 3 new states (archive confirm, discard, partial save) not designed |
| 01b Staff and roles | [01b-staff-roles.md](01b-staff-roles.md) | v1.0 approved (2026-10-27), backend being built | 24 | first hand-off (30 frames) out of date; rewritten 2026-10-27 for a new design (see its §10) |
| 01c Menu variants, modifiers, deals | [01c-menu-variants.md](01c-menu-variants.md) | no spec (before 02) | 11 | not designed |
| 02 Ordering + Tables | [02-ordering-tables.md](02-ordering-tables.md) | no spec | 33 | not designed (listed as provisional in ui-brief §2) |
| 03a Timing engine | [03a-timing.md](03a-timing.md) | no spec | 7 | not designed |
| 03b KDS + Printing | [03b-kds-printing.md](03b-kds-printing.md) | no spec | 27 | not designed |
| 04 Voids + Audit | [04-voids-audit.md](04-voids-audit.md) | no spec | 19 | not designed |
| 05 Billing | [05-billing.md](05-billing.md) | no spec | 36 | not designed |
| 06 Offline + Sync | [06-sync-backup.md](06-sync-backup.md) | no spec | 15 | not designed |
| 07 Owner view | [07-owner-view.md](07-owner-view.md) | no spec | 10 | not designed |
| **Total** | | | **239** | 38 exist in code (00: 15, 01a: 23); none has design frames |

## Conventions used in every file

**Screen IDs** `<module>-<kind><nn>`: `S` screen, `D` dialog or sheet, `B` banner or inline state, `F` full-screen device state, `N` notification, `C` component or field, `P` printed layout. Example: `02-D02` parking details sheet, `03b-P01` 80 mm kitchen ticket.

**Devices**

| Code | Device | Size | Notes |
|---|---|---|---|
| K | Cashier kiosk, Windows Chrome/Edge kiosk mode | 1920 × 1080 landscape | mouse, keyboard, touch; **no browser back**; every screen needs its own way back |
| T | Android tablet (Capacitor app) | 1280, portrait and landscape | touch only; waiter ordering, admin |
| P | Staff phone (BYOD, hub-served browser; iPhone as Home Screen app) | 360–390 wide | cheap Android, older Chrome; one-handed |
| W | Kitchen screen (KDS) | 1920 × 1080 or 1280 tablet on the wall | dark theme, read at 1–3 m, 72 px targets, greasy hands |
| L | Owner laptop (cloud owner app) | 1440 | internet |
| OP | Owner phone (cloud owner app) | 390 | internet |

**LTR** means the value never mirrors in Urdu RTL: prices, quantities, PINs, codes, car numbers, phone numbers, times, dates, IPs, IDs (wrap in `.pos-ltr` or mono).

**Story IDs** (stories-refined has none; these are assigned here, with the story title):

| ID | Story | ID | Story |
|---|---|---|---|
| E0-MENU | Categories, items, variants, add-ons, combos | E2-TBL | Table management and order types (AC6 appears twice: 6a lock keep-alive, 6b move) |
| E0-AVAIL | Item availability — toggle and schedule | E2-ADD | Adding items to a running order |
| E0-ORD | Hold/park, notes, reorder, reprint | E2-ETA | Per-item ETA preview |
| E0-REF | Refunds, cancellations, complimentary items | E2-SOLD | Sold out and slow items |
| E0-PAY | Payments at checkout | E3-KDS | Station KDS screen |
| E0-SHIFT | Cashier shifts, day open/close, petty cash, Z report | E3-PRT | Thermal printing — station tickets |
| E0-PIN | PIN login on shared devices | E3-RCPT | Counter receipt |
| E0-REP | Sales reports and tax report | E4-ETA | ETA calculation |
| E0-HW | Printers, cash drawer, multiple terminals | E4-HF | Hold-and-fire dispatch |
| E0-BAK | Automatic backups and restore | E4-SLIP | Slip warning |
| E0-TPL | Receipt and ticket templates | E5-OFF | Fully offline operation |
| E1-FLR | Floors, tables and stations | E5-DEV | Device resilience during hub restart |
| E1-ROUTE | Menu item recipe route | E5-PWR | Hub restart after power loss |
| E1-STOCK | Pre-cooked stock — daily entry | E6-ROLE | Custom roles and permissions |
| E10-CNT | Live pre-cooked stock countdown | E6-LIFE | Item lifecycle enforcement |
| E13-LANG | Interface language and large icons | E6-PVOID | Pending void on bill and table close |
| E8-SPLIT | Split bills and mixed payments | E6-AUDIT | Immutable audit log |
| E8-ZR | Shift close and day-close Z report | E8-TAX | Tax-compliant invoices |

Only **P1** stories are inventoried. P2–P4 stories (price lists, delivery orders, customers, clock-in, QR tracking, training mode, learned cook times, dashboards…) have no screens here; where a P1 story mentions one (delivery and web order types, customer tracking page) it is an open question in that module.

**Sample restaurant:** Arif Chatkhara, Lahore — Gulberg and Johar Town branches (third later), 1 500–2 000 orders/day/branch, rush at lunch 12:30–15:00 and dinner 19:30–23:30, breakfast 07:00–13:00. Menu: Paye (plate, degh overnight, sold out once gone), Chicken Karahi (by kg, half/full), Naan / Roghni naan (tandoor), Seekh kebab (BBQ, counted pieces), Lassi (300 ml glass from a jug counted in L). Parking customer: car LEB 1234, sedan, 0300 1234567. Staff: Arif (owner), Imran (manager), Sana (cashier), Bilal, Ali (waiters).

---

## Global components

Reusable parts across modules. "Exists" = in `apps/client/src/components` or the kit today.

| Component | Exists | Used by |
|---|---|---|
| Banner (ok / warn / danger / info, icon + word) | yes (`Banner`) | every screen; 01a-B*, 02-B*, 03a-B*, 05-B*, 06-B*, 07-B* |
| Busy button (+ 3 s "Still working" banner) | yes (`BusyButton`) | every form and command |
| PIN pad (6 dots, shake, locked, LTR) | yes (`PinPad`) | 00-S03, 00-S07, 01a-S10, 02-S02, 01b-D01, 05-D06/D08 (manager ack) |
| Name tiles (selected, locked "Locked · 14 min") | yes (`StaffTiles`; locked note **not rendered yet**) | 00-S03, 00-S07, 01a-S10, 02-S01, 00-S17, 01a-S02 (branch tiles) |
| Quantity input (pieces / kg / L, LTR) | yes (`QuantityInput`) | 01a-S07, 01a-S11, 02-D04, 01c-D01 |
| Available hours field | yes (`WindowsField`) | 01a-S06, S07, 01c-S05 |
| Dialog + scrim (focus trap, Escape — missing today) | kit yes | every `-D` |
| Full-screen state (icon, title, body, one action) | kit yes (`.pos-screen`) | 00-F*, 00-S02/S04/S05/S09–S15, 02-B09, 03b-S04, 06-S06/S07 |
| QR tile (white tile, `qrSvg` from the hub) | kit yes | 00-S02, 00-S10, 00-S17, 05-S16, 06-S07 |
| Display code (72 px, accent underline) | kit yes | 00-S10, 00-S08 |
| App bar / page header (title, branch, signed in as, sign out, status dot) | **no** (kit gap) | 01a all, 01b all, 02-S03, 05-S02, 07 all, hub admin |
| Navigation / tabs (owner nav, floor tabs, report tabs) | **no** | 01a-S02, 02-S03, 05-S05, 07 |
| List row / table row | **no** | 00-S16/S18/S19, 01a-S03/S05/S11, 01b-S01/S03, 04-S02/S03, 05-S02, 06-S02 |
| Switch / toggle (On sale / Off, Show archived, settings) | **no** | 01a-S03/S05/S11, 01b-S07, 05-S15 |
| Segmented control (Cashier/Kitchen, Half/Full, split mode, Active/Archived) | **no** | 00-S08, 02-D04, 05-S05, 01a-S05 |
| Badge / chip (stock "4 left", slow clock, Sold out, Not now, Late, Needs approval, Removed) | **no** | 01a-B15, 02-B06, 02-S03 tiles, 03b-C01, 04-S01 |
| Sticky action bar (Save N counts, Send to kitchen, Close bill) | **no** | 01a-S11, 02-S05, 05-S04 |
| Toast / transient confirmation (Saved, Order sent) | **no** | 01a-B17, 02-D07, 03b-N01 |
| Empty state (icon, sentence, one action) | **no** | every list |
| Skeleton / loading placeholder | **no** | 02-S03, 03b-S01, 07-S02 |
| Table tile (name, state word + icon + colour, lock name, timers, badges) | no | 02-S03, 02-D09/D10 |
| Menu item tile (name, price per unit, chips, disabled reason) | no | 02-S05, 02-S10 |
| Cart line (qty, options, note, price, ETA) | no | 02-S05, 02-S06, 05-S03 |
| Order identity header ("T7", "Parking LEB 1234 · Sedan", "Takeaway #42") | no | 02-S05/S06/S07, 03b-C01, 03b-P01, 05-S02/S03 |
| ETA display (clock time, "Together at", "6 min late") — rules 03a-C01 | no | 02-S05/S06/D07, 03b-C01 |
| KDS ticket card (all states, 72 px Start/Done) | no | 03b-S01–S03 |
| Notification card + list (slip, void approval, printer, escalation) | no | 03b-N01–N03, 04-N01/N02, 06-B03 |
| Reason picker (preset + text, required) | no | 04-D02/D04/D06/D08, 05-D01–D03, 05-S06/S07, 02-D09 |
| Money input (Rs, commas, LTR) and money display ("Rs 2,200", "Rs 2,200 / kg") | parse exists (`money.ts`), no component | 01a-S07, 01c, 05 all |
| Permission-aware action (hidden / "Needs approval" tag) | no | every action with a permission (R5) |
| Date range picker | no | 04-S03, 07-C01 |
| Print layouts 58 / 80 mm (monospace grid) | no | 03b-P01–P06, 05-P01–P04 |

## Global states (every hub-served screen)

| State | Where defined | Rule |
|---|---|---|
| Hub unreachable / reconnecting | 00-F01; 01a-B16; 02-B02 | calm, keep what's on screen and typed, retry quietly (backoff ≤ 5 s); never a blank page |
| Order or input kept on the device | 02-B03; 01a (Q4 there) | drafts survive Wi-Fi loss, hub restart, app restart, logout |
| Waiting to send (queued commands) | 02-B02, 02-D07 | no "sent" until the hub acknowledges (E5-DEV AC4) |
| Session expired / idle logout | 02-B09 → 02-S01 | unsent work kept; back to the same screen after login |
| Takeover (someone else logged in) | 02-D01 | "Bilal is logged in — log him out?"; 05-D12 for an open cash shift |
| Forced logout by a manager | 00-D02 → 02-S01 | same as idle |
| Unsent orders from an ended session | 02-D14 | policy open (02 Q20) |
| Device must be paired again | 00-F02, 00-F08 | wipe token, start pairing |
| Wrong Wi-Fi (guest network) | 00-F03 | "Connect to the staff Wi-Fi" |
| App too old | 00-F04 | blocking "Update the app" |
| Hub busy | 00-F05 | retry once, then "Hub busy, try again" |
| Hub being set up / wrong address | 00-F06, 00-F07 | — |
| Permission: not granted / denied | every screen | hide the action; never a disabled button with no reason |
| Permission: requires approval | every screen | show the action with "Needs approval"; result is a pending state (04-B01 for voids) |
| Read-only | 01a-B01 (menu), 02-S06 (not lock holder), 04-S03 (audit) | one info line saying why |
| Error by code | each file's per-screen states | text from `errors.<CODE>`, never the server message; say what to do next |
| No internet (hub fine) | 06-B01; 05-B02; 01a-B10 "· offline" | everything still works except online payments and owner-app edits |
| Cloud unreachable (owner app) | 01a-B04 | no offline mode; keep the form |
| Clock alarm | 03a-B01, 06-B02 | danger banner on admin and every KDS |
| Hub restarted, catching up | 03a-B02; 03b-P03 REPRINT | — |
| Concurrent edit by another device | 01a-S11 (poll), 02-S03 (`TABLE_ALREADY_LOCKED`), 04-D06 ("already approved") | refresh, explain who, never lose typed values |

## Settings that need a home

Settings are data (R18). These are named by stories or specs but have no screen owner yet; the designer should not invent a place before the owner answers.

| Setting | Default | Story/spec | Proposed home |
|---|---|---|---|
| Tax on/off per branch, stale-day hours, min gap | off / 16 h (1–48) / 4 h (0–12) | 01a §6.7, 01b B16 | 01b-S07 |
| Session idle limit per role | Owner 60, Manager 60, Cashier 15, Order taker 15, Waiter 5, Cook 5 (1–240 min) | 01b B13, §6.15 | 01b-S08 |
| Table colours | story palette | E2-TBL AC1 | ? (02 Q5) |
| Slip threshold, escalation time, slow threshold, lock TTL, cascade step | 5 min / ? / ? / 10 min / 1 min | E4-SLIP, E2-SOLD, D51, D44 | 03a-S02 (03a Q2) |
| KDS alert volume per station | — | E3-KDS AC5 | 03b-S05 |
| Station output (screen/printer/both), printers, paper width | — | E3-PRT AC1, R8 | 03b-S07 (03b Q1) |
| Resell flag, void timeout override | off / off | E6-LIFE, E6-PVOID AC4 | 04-S06 (04 Q1) |
| Payment modes, tax rules, receipt template, service charge, tips, rounding, thresholds | — | R7, R12, E0-PAY, E8-TAX | 05-S12–S15 |
| Backup time | quiet hour, 04:00 | D63 | 06-S03 |

## Hub admin has no home

Every hub admin job (devices, sessions, lockouts, stock, live capacity, printers, sync, backups) is a separate URL today; no spec defines an admin home or menu (00 Q1). Designing one is needed but must go through a spec first.

---

## Suggested design order

Follows the README build order and milestone A (pilot 2027-02-28: 00, 01a, 01c, 03a, 02, 01b, 04, 03b, 05 + 06's nightly USB backup). Design work leads build, and the shared components come first because 02 reuses them.

1. **Shared components and global states** (app bar, list row, switch, chip, segmented control, sticky action bar, toast, empty state, notification card, PinPad/StaffTiles changes; 00-F01…F08). Needed by everything after.
2. **01b Staff and roles** — small, owner app; unblocks real staff names and permissions for 02 (01b-S01–S10; see 01b §10 for what the new design must add). Also replaces 01a-S02 branch IDs.
3. **01c Menu variants, modifiers, deals** — shapes the order line and 02-D04 (01c-S01–S06).
4. **02 Ordering + Tables** — the core pilot surface: login, table map, order screen, parking, table view, offline queue (02-S01…S10, D01…D14, B01…B09). Include 03a-C01 ETA rules and 03a-D01 boost.
5. **03b KDS + Printing** — KDS views and ticket states, slip notifications, ticket and receipt layouts (03b-*).
6. **05 Billing** — bill, payment, split, shift close, day close, Z report, owner config (05-*).
7. **04 Voids + Audit** — item actions, approvals, audit log (04-*); its sheets plug into 02-S06 and 05-S03, so design them alongside 02/05 if time allows.
8. **01a redesign** (built, working; redesign improves daily stock use) and **00 admin lists** (00-S16…S20).
9. **06 Sync and backup** — pilot needs only 06-S02/S03/B04 (USB backup); the restore wizard and replace hub are milestone B.
10. **07 Owner view** and **03a** settings/capacity — milestone B.

Design every screen in English and mirrored Urdu (RTL, Latin digits, R20); kitchen screens in the dark theme.

---

## Coverage summary

- **Screens: 230** — 00: 31, 01a: 26, 01b: 15, 01c: 11, 02: 33, 03a: 7, 03b: 27, 04: 19, 05: 36, 06: 15, 07: 10.
- **P1 acceptance criteria with no screen: 7**, each a spec decision or out of P1:
  1. E0-MENU AC2 — item image upload (not in the 01a spec)
  2. E1-FLR AC1 — 2-D floor canvas (spec: tiles per floor, no positions)
  3. E1-FLR AC2 — table shape and position (same)
  4. E0-AVAIL AC4 — days of the week in schedules (01a windows are daily)
  5. E10-CNT AC4 — web/QR ordering (P4/P2)
  6. E4-SLIP AC5 — customer tracking page (P2, D20)
  7. E8-TAX AC5 — PRA e-IMS integration (deferred, R13)
- **ACs that need no screen** (back-end rules or installation): E0-PIN AC3; E5-PWR AC1–4, AC9, AC10; E5-DEV AC3; E5-OFF AC1; E0-HW AC2, AC6; E0-TPL AC4; E4-ETA AC4; E4-HF AC7; E8-TAX AC4 (15).
- **Partly blocked:** E2-TBL AC9 delivery and web order types (02 Q7); E0-AVAIL AC5 changed by 01a S47 (window wins over a manual On).
