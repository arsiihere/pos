# Restaurant POS — Refined User Stories

Oct 22, 2026 · Arslan Ahmed Arif  
Refined via brainstorming session — decisions logged in §1 below.

---

## §1. Refinement decisions log

These decisions were made during the brainstorming session. They apply across all epics and override any ambiguity in the original stories. Every acceptance criterion below derives from one or more of these.

| ID | Decision | Epics affected |
|----|----------|----------------|
| D1 | QR order tracking has two URLs: an internet URL (cloud-hosted) and a local WiFi URL (hub-served). Customer page detects internet failure and prompts the customer to join restaurant WiFi. Waiter/receipt shows both URLs. | E9, E5 |
| D2 | Every order — including mid-meal add-ons — is independent. Each gets its own ETA calculated at submit. No cross-order coordination unless boost is applied. | E2, E4 |
| D3 | Boost is a role-permission action. It moves an order to the front of the station queue immediately. Every order displaced by the boost receives an automatic slip warning to its waiter. The waiter's notification does not expose the reason for displacement (no "VVIP" language). | E4, E6 |
| D4 | P1 timing engine: single primary station per item plus an optional prep buffer (duration added before the station fires). Multi-station chains (item passes through two or more stations in sequence) are out of P1; the schema is designed to support them from day one so P2 can unlock them without migration. | E1, E4 |
| D5 | Table locking: opening a table fires an event; all devices show the table as locked to that user (color change) in real time. No other user can place or edit an order on a locked table unless they hold the "take order anywhere" permission. The lock is released by an explicit close action, a force-release by a manager, or automatically when the holder's session expires or the lock TTL passes (D51). Order takers are assigned to floors or tables by default. | E2, E6 |
| D6 | When an order is running late, the customer-facing tracking page shows the original promised time plus a "running X minutes late" notice. The original time is never silently changed. | E4, E9 |
| D7 | Pre-cooked stock is reserved on order submit only, not during order building. When two orders submit simultaneously for the last unit, first-submit-wins; the second submitter immediately sees a corrected ETA using the full cook time. | E4, E10 |
| D8 | Checkout always shows all payment options: cash, split, multi-split, card, wallet/QR, bank transfer. Card terminals in Pakistan carry their own SIM and are independent of restaurant internet; the POS records the amount manually after the terminal approves. Wallet/QR payments that require internet degrade gracefully ("unavailable") when internet is down. Payment methods are pluggable per country. | E8 |
| D9 | FBR and all other country-specific tax-authority integrations are out of P1 (PRA is a conditional exception — see D58). The integration architecture is pluggable but no actual transmission happens until the pilot is validated. P1 delivers: correct tax calculation, tax number on receipts, and fully customisable receipt templates. | E0, E8 |
| D10 | Item lifecycle for voids and returns (five stages): (1) Added, cooking not started → the person who added it can remove it, no approval needed. (2) Cooking started → needs a role with void or move-to-stock permission. (3) Cooked, not yet served → can be moved to ready stock and reassigned to another order. (4) Served → mark as returned only; reason required; goes to wastage or staff meal. (5) Resell a served item → off by default; owner can enable per restaurant. | E6 |
| D11 | A pending void shows on the bill as pending and is excluded from the total. Approval-holders receive an urgent alert. The table cannot be closed until every pending void is resolved. A configurable timeout-override rule allows closure after N minutes if no approver acts (off by default). | E6, E8 |
| D12 | P1 language: English only. All UI text is stored in translation keys; no hardcoded English strings in components. RTL layout is supported in the framework but not activated until a RTL language is added. Urdu and all other languages are post-P1. | E13 |
| D13 | Two station types configured at setup: (a) slot stations — capacity = number of items that can cook concurrently; a new item starts as soon as a slot frees; (b) batch stations — all items in a load start and finish together. The engine's promise-first logic applies identically to both; nothing is hardcoded to any specific item or station. | E1, E4 |
| D14 | Hold-and-fire batching rule for batch stations: the engine never delays a fire past the latest-start time of the earliest-deadline item. At that fire time it pulls in other pending items for the same station whose target land times fall within the station's freshness window, filling capacity without making any item ready too early. Items outside the window wait for the next fire. The freshness window is a per-station configurable duration. | E4 |
| D15 | Table-lock conflict during hub outage (P4 scope only): on event replay, first-timestamp-wins; the conflicting device receives a notification; manager is alerted. In P1–P3, the hub is always the lock authority (internet may be down but hub is running), so this conflict cannot occur. | E5 |
| D16 | Each item has a serve mode: immediate (sent to the table as soon as it is ready, not held for the rest of the order) or sync (lands together with the order's other sync items). Target land time for an order is calculated over its sync items only. Default serve mode is configurable per item. | E1, E4 |
| D17 | The freshness window (D14) is the only setting controlling how early an item may be ready. The separate "too-early threshold" is removed. A freshness window of 0 means no items are pulled in early; each batch fires at its earliest item's latest-start time. | E1, E4 |
| D18 | Reserved pre-cooked stock is released back to the pool when an item is voided at stage 1 or 2 (D10). At stage 3 the item moves to ready stock (not back to the pre-cooked pool). | E4, E6, E10 |
| D19 | Effective permissions across multiple roles: the most permissive grant wins (allowed > requires-approval > not granted). An explicit "denied" can be set only by the owner on an individual staff member and always overrides all role grants. | E6 |
| D20 | The receipt tracking QR is disabled in P1 and enabled when the customer tracking page ships in P2. | E3, E9 |
| D21 | Blind cash count happens at every cashier shift close, not only day close. Each shift has its own float, cash drawer session, counted amount, expected amount and variance. Day close requires all shifts to be closed and shows the combined totals. | E0, E8 |
| D22 | P1 includes a basic remote owner view via cloud sync: sales, voids, discounts, payment methods, sync status and last backup time, per branch and combined. It is read-only. The full owner dashboard and analytics remain P2. Resolves OQ8. | E0, E11 |
| D23 | In P1, hold-and-fire target land times are fixed at submit and recalculated only on explicit events: void, boost, and stock count update. Re-planning when the queue moves faster than expected is P2, once real cook-time data exists. Resolves OQ9. | E4 |
| D24 | Hub power loss and restart. Target: hub fully operational within 90 seconds of power returning, no manual action. Hardware: SSD storage, BIOS "power on after AC loss", hub/router/printers on UPS. Service starts automatically via systemd. Durability: event acked only after durable SQLite commit (WAL, synchronous=FULL); devices resend unacknowledged events; idempotent event IDs prevent duplicates. Recovery: hub rebuilds all state from latest snapshot plus replay of later events. Missed fires on restart: dispatched immediately as "fire now"; affected orders get slip warnings. Late taps: accepted with device timestamp, corrected to hub clock. Print queue: resumes in order; unconfirmed jobs reprinted with "REPRINT" header (duplicate acceptable, missing is not). Devices reconnect and re-render automatically. Restart events recorded in audit log. | E3, E4, E5, E6 |
| D25 | Config snapshot per order. Every `OrderPlaced` event snapshots each item's cook time, station, serve mode, prep buffer, price, and tax class into its payload. Those values are the source of truth for that order's ETA and billing; subsequent menu changes apply only to future orders. No conflict rule blocks menu edits while open orders exist. | E1, E4, E8 |
| D26 | Item availability and live overrides are hub-owned, not cloud-owned. The hub controls what is available or unavailable on any given shift. The cloud owns only the canonical menu definition (prices, cook times, station routes). Availability events are synced to the cloud but the hub is the authority for live state. | E0, E1 |
| D27 | Engine ETA model uses a reservation timeline, not a FIFO queue. Each station maintains a list of planned capacity windows (startsAt, endsAt per item or batch). ETA for a new item = the earliest time a slot opens in the timeline. This gives accurate ETAs when items have different cook times and avoids the systematic under-estimate of a simple queue-length × average-time model. | E4 |
| D28 | Network separation and PIN security. Staff WiFi is separate from the customer guest network; the hub rejects staff API traffic (auth, commands) from guest-network IP ranges. PINs are transmitted as plaintext over the staff network — no client-side hashing. The hub verifies PINs against an argon2id (preferred) or bcrypt hash. Lockout: 5 consecutive failed attempts locks the account for 15 minutes (configurable). Session idle timeout: configurable per role; default 5 minutes for order takers. | E0, E5 |
| D29 | FireNow does not advance item stage. Stage 2 (COOKING) begins only on an explicit Start tap by kitchen staff — not on the engine's FireNow dispatch event. Stage 2 void: item goes to ready stock or wastage (reason required); reserved pre-cooked stock is NOT returned to the pre-cooked pool. Only a stage 1 void returns stock to the pre-cooked pool. Exception: on a single-tap station (D43), Start is inferred at fire time. | E3, E4, E6, E10 |
| D30 | Mandatory tenant scoping from P1 (mechanism strengthened by D54; cloud framework is Fastify per D55). Every cloud route that reads or writes data passes through a tenant-scoping guard that resolves tenant_id and branch_id from JWT claims. Repository methods require both as parameters. Pilot has 3 branches; P3 adds paying tenants. App-level guards are sufficient over PostgreSQL RLS at this scale. | E0, all cloud routes |
| D31 | FOOD_ON_TABLE table state is set when the first item in the order is marked served (runner delivers / waiter marks served) — not when it is marked Done at the station. An item is Done when cooking is complete; it is served when it reaches the table. These are two separate events. | E2, E3, E6 |
| D32 | Command idempotency. Every command carries a device-generated ULID `command_id`. The hub stores processed command_ids with their response in a `processed_commands` table, written atomically in the same SQLite transaction as the event INSERTs. A repeated command_id returns the stored response and writes nothing new. The lookup is repeated inside the write transaction (authoritative re-check) so concurrent retransmits cannot both succeed. Rows older than 7 days are pruned daily. Event IDs remain hub-generated ULIDs. | E5 |
| D33 | Overrun handling. When an item is still COOKING past its planned station `endsAt`, `live_endsAt = max(planned_endsAt, now)`. If Start is tapped late, the reservation shifts to `[actualStartAt + prep, actualStartAt + prep + cook)`. Slip warnings use estimated land time vs original promise. Capacity checks always use live reservation values. | E4 |
| D34 | Fired batches are closed. A batch load can only be joined if `b.startsAt > now`. An item that would otherwise fit (by freshness/capacity) cannot join a batch that has already fired. | E4 |
| D35 | Prep buffer is not station time. Station reservations cover only the cook interval: `[start + prep, start + prep + cook)`. Prep happens off-station and does not consume station capacity. Land time still includes prep. All ETA formulas, reservation lifecycle, and unit tests updated accordingly. | E4 |
| D36 | Intra-order collisions. Immediate items are tentatively reserved first; their tentative intervals count in the sync capacity check. For same-station sync items, the engine serialises them (longest-cook-first): each item's station interval starts where the previous one ends; individual land times are staggered; the order's target_land_time = the latest individual land time. | E4 |
| D37 | Live station capacity override. A manager can change a station's `capacityOverride` at any time from the hub admin UI; works offline. A capacity change triggers recalculation: existing reservations on the station are rebuilt with the new effective capacity; displaced items are moved later with slip warnings. | E1, E4 |
| D38 | Admin and pairing auth. `hub:3000/admin` requires a manager PIN session before any admin action (same argon2id check as device PIN auth). QR pairing token generation is a permissioned action (requires "manage-devices") and is written to the audit log. Device pair and revoke events also audited. First-run `hub:3000/setup` is protected by the one-time cloud registration code only (no PIN exists before first sync) and is disabled permanently once the hub is provisioned. | E0, E5 |
| D39 | Lock scope. LOCKED restricts only creating and editing orders. Marking items served, requesting the bill, closing the bill, and marking the table as needing cleaning are allowed with the relevant role permission regardless of who holds the lock. | E2, E6 |
| D40 | PIN distribution. The setting device hashes the PIN with argon2id before transmission; the cloud stores only the hash and pushes it to every hub where the staff member is assigned. Plaintext PINs are never stored or transmitted beyond the setting device. Adding or resetting a staff PIN requires internet (P1 limitation). | E0 |
| D41 | Heartbeat. The hub writes a heartbeat timestamp every 60 seconds to a `hub_heartbeat` table (one row per branch, not the event log). On restart, `hub_down_at` in the HubStarted audit event = `last_beat` from this table, not the last `HubStopped` event. | E5 |
| D42 | Overrun and late-start cascade. When an overrun or a late Start pushes an item into the next reservation on its station, later not-yet-started reservations on that station shift later by the minimum amount, moving their latest-start times with them. Other stations do not move. Order target land times are not changed; affected orders get slip warnings past the threshold, and on-time sync siblings are shown on KDS as "hold at pass". | E3, E4 |
| D43 | Tap dependency and completion modes. The engine consumes only "item started" and "item done" facts, each tapped or inferred. Each station has a completion mode: two-tap (Start and Done tapped), single-tap (Start inferred at fire time, Done tapped; replaces "skip-start"), or auto-done (Done inferred at planned end). Only overrun handling (D33, D42) and hold at pass depend on tap reliability; the engine core does not. A pre-engine tap-rate field test (OQ4) sets the default mode per station. | E3, E4 |
| D44 | Tick mutations are events. Everything the fire scheduler does on its own (fire an item, shift reservations after an overrun, warn of a slip, auto-release a table lock) is first written as an event (`FireDispatched`, `ReservationsShifted`, `SlipWarned`, `TableLockReleased`) and only then applied. A fire already dispatched is never dispatched again, including after a restart; slip warnings are not repeated unless the slip grows by another threshold; overrun shifts move in fixed steps (default 1 minute). | E3, E4, E5 |
| D45 | Commit then swap. The hub computes the next engine state alongside the live one and replaces the live state only after the SQLite COMMIT succeeds. A failed write leaves the live state untouched. | E4, E5 |
| D46 | Event schema versioning. Every event carries a `schema_version`. Stored events are never rewritten; upcasters convert old versions to the latest on read (replay, cloud ingest). A change that cannot be a pure upcast becomes a new event type. | E5 |
| D47 | Money is integer minor units. Every amount everywhere (events, database, APIs) is an integer number of paisa (minor units of the tenant currency). No floats or decimal strings; rounding happens once, at a point the Billing spec defines, using the restaurant's rounding method. | E0, E8 |
| D48 | Clock guard. The hub clock may never run earlier than the newest event in its log: if it does at boot (e.g. a dead RTC battery), the hub raises a ClockAlarm, shows a banner, and continues from the last event time. Each sync records the hub-to-cloud clock offset; an offset over 60 s raises a ClockAlarm. The RTC battery is checked at installation. | E5, installation |
| D49 | Batch load compatibility. A batch station defines cook programs (e.g. fry 180 °C for 6 min). A load runs one program, and only items with the same program can share it. A new load's station time excludes prep (D35). | E1, E4 |
| D50 | Single stock authority. Pre-cooked stock exists only as events (`StockSet`, `StockReserved`, `StockReleased`) and the one projection built from them on the hub; there is no separate stock table. Reservation at submit checks that projection inside the hub's single-writer transaction (first-submit-wins, D7). | E4, E10 |
| D51 | Table lock auto-release. A lock is released automatically when the holder's session expires or logs out, or when the holder has not touched the table for the lock TTL (default 10 minutes). Unsubmitted edits stay on the device; the next submit re-acquires the lock if the table is still free. | E2, E6 |
| D52 | Immutable events and sync cursor. Event rows are never updated or deleted (enforced by database triggers). Sync progress is one cursor (`last_acked_seq`) per branch. The cloud accepts only gap-free batches and rejects a batch that would leave a gap in the sequence. | E5 |
| D53 | Hub replacement and nightly USB backup. Every night the hub backs up its database to an attached USB drive (verified, last 7 kept, result audited). A replacement hub for an existing branch is provisioned with a replace-hub code, restores from the old disk, the USB backup or the cloud (in that order of preference), and pulls the missing tail of events from the cloud. Device tokens are stored hashed. | E0, E5 |
| D54 | Mechanically enforced tenant scoping (strengthens D30). The tenant guard is on by default for every cloud route; opting out needs an explicit allowlist entry. All data access goes through a tenant-scoped repository base class. Automated tests fail on any unguarded route or cross-tenant leak. | E0, all cloud routes |
| D55 | One backend framework. Hub and cloud both use Fastify 5. | all cloud routes |
| D56 | Windows cashier runs the hub-served React app in Chrome or Edge kiosk mode, auto-started at login. Revisit if the cashier PC needs its own attached hardware. | E0, E8 |
| D57 | Pilot cloud is sized for cost: AWS ap-south-1, one small instance, the smallest single-AZ managed Postgres (free tier or credits where eligible). Latency is irrelevant in P1 because live operations run on the hub. The owner confirms the region (OQ10). | Cloud setup |
| D58 | PRA conditional P1 blocker (amends D9). If Arif Chatkhara is required to issue PRA-integrated invoices (PRA e-IMS: invoice number and QR on each receipt), PRA integration is in P1 scope; otherwise D9 stands. Answered by OQ15. FBR and all other authorities stay out of P1. | E0, E8 |
| D59 | Shared Standards. All module specs inherit one set of standards from the foundation spec §6: response envelope, error-code catalogue and HTTP status map, hub command and query conventions, versioned cloud routes (`/v1`) with an `Idempotency-Key` on creates, WebSocket message format, naming rules (one event per fact, e.g. ItemStarted, ItemDone, ItemServed; never a generic "changed" event), test and fixture conventions, migration conventions, and per-app folder layout. New error codes are defined in the module spec that introduces them and appended to the foundation list. | all |
| D60 | Inferred completion facts. On a single-tap station the hub records the inferred "started" fact in the same transaction as the fire, so an item is never fired without being started. On an auto-done station the hub records an inferred "done" fact once the planned cook time has elapsed. | E3, E4 |
| D61 | Keeping a table lock while building. While an order screen is open on a locked table, the device refreshes the lock at most once a minute (`TouchTableLock`); the hub also ignores refreshes under 50 seconds apart. A slow, large order no longer loses its lock to the lock TTL. | E2 |
| D62 | Engine version on snapshots. Every engine snapshot records the engine version that wrote it. After an upgrade that changes the engine, the hub ignores old snapshots and rebuilds by replaying the full event log, then takes a fresh snapshot. | E5 |
| D63 | Backup time defaults to the branch's quietest hour (fewest events over the last 14 days; 04:00 until there is enough data). A manager can set a fixed time instead. | E0 |
| D64 | Foundation freeze. Foundation spec v1.7 is final. Later issues are handled in module specs or unit tests, not by reopening the foundation; the only foundation edit allowed is appending new error codes. | all |

---

## §2. Phased roadmap (unchanged from original)

| Phase | Gate |
|-------|------|
| P1 | One full month of real rushes at Arif Chatkhara with no lost orders and staff who trust the ETAs they give customers |
| P2 | Owner trusts stock variance and the daily summary without double-checking |
| P3 | 10–15 owner conversations done; first paying restaurants outside the pilot |
| P4 | Scale and sell |

---

## §3. Refined stories by epic

Format per story: story → acceptance criteria → in scope / out of scope → edge cases.  
Phase label preserved. Scope notes only appear where a decision narrows or expands the original.

---

### E0. Table stakes

#### Menu management

---

**[P1] Categories, items, variants, add-ons, combos**

*As an admin, I want categories, items, variants (half/full, sizes), add-ons and combos/deals, each with its own price, image, tax class and station route.*

Acceptance criteria:
1. Admin can create, edit, and archive categories; items belong to exactly one category.
2. Each item has: name, description, image upload, base price, tax class, primary station, optional prep buffer (duration), and cook time at primary station.
3. A second "stock time" can be set per item — the faster cook time used when pre-cooked stock is available; engine switches automatically to full cook time when stock reaches 0.
4. Variants (e.g. half/full, sizes) are modifiers that can independently override price, cook time, or station.
5. Add-ons are optional extras that can add price and optionally change station.
6. Combos group items with a combined price; shown as a single line at ordering with the combo price.
7. Archived items disappear from the ordering screen but remain in historical reports and audit logs.
8. All items carry a tax class; tax is calculated per item and summed on the bill.

In scope (P1): single primary station + prep buffer, English labels, all fields above.  
Out of scope (P1): multi-station chains (P2+); price lists by branch/order type/time (P2); non-English labels (post-P1).

Edge cases:
- A variant overrides the station to one that has not been configured → validation error at setup; must select a configured station.
- A combo contains an unavailable item → combo shown as unavailable.
- A zero-price add-on (e.g. extra napkins) → valid; must be allowed.

---

**[P1] Item availability — instant toggle and schedule**

*As an admin, I want to mark items available or unavailable instantly, and schedule availability (breakfast menu, weekend-only items).*

Acceptance criteria:
1. Any item can be toggled available/unavailable; change is reflected on all ordering screens within 5 seconds.
2. Unavailable items are shown greyed-out with an "unavailable" label (not hidden) so staff can explain to customers.
3. Unavailable items cannot be added to an order; if attempted, the order taker sees a clear message.
4. Scheduled availability: admin sets days of week and time ranges; item auto-toggles at each boundary.
5. Manual toggle overrides the schedule until the schedule's next boundary, at which point schedule resumes.

In scope (P1): manual toggle + day/time scheduling.  
Out of scope (P1): branch-level or order-type-level availability overrides (P2).

Authority (D26): item availability is hub-owned. The hub controls what is live at any moment; the cloud owns only the canonical menu definition. Availability changes are written as events on the hub and synced to the cloud.

---

**[P2] Price lists by branch, order type, and time**

*As an admin, I want price lists by branch, order type and time, e.g. delivery prices differ from dine-in, happy-hour pricing.*

Acceptance criteria:
1. A price list has: name, branch scope (all or specific branches), order type scope (dine-in / takeaway / delivery / all), and a time range.
2. When multiple price lists match an order, the most specific wins: branch > order type > time range.
3. Default item price is used if no price list matches.
4. Price list changes take effect on the next order; in-progress orders retain the price at which they were opened.

---

#### Orders

**[P1] Hold/park, notes, reorder, reprint**

*As an order taker, I want to hold or park an order, add order and item notes, reorder a previous order, and reprint any ticket.*

Acceptance criteria:
1. "Hold" parks an order without sending it to the kitchen; held orders are visible to the same device and to the manager view.
2. Order-level notes (whole order) and item-level notes (per line item) are free text, printed verbatim on the kitchen ticket.
3. "Reorder" loads a previous order's items pre-populated into the current order screen; ETA is calculated fresh at submit.
4. Any kitchen ticket can be reprinted by any user whose role includes the reprint permission; every reprint is logged.

Edge cases:
- Reorder contains an unavailable item → item shown as unavailable; order taker decides whether to proceed with the remaining items.
- Reprint requested when station printer is offline → job is queued; prints when printer reconnects.

---

**[P1] Refunds, cancellations, complimentary items**

*As a cashier, I want refunds, partial refunds, cancellations and complimentary items, all running through roles and approvals.*

Acceptance criteria:
1. Full refund: marks all items as returned; follows item lifecycle (D10); reason required.
2. Partial refund: cashier selects specific items or enters a partial amount; reason required.
3. Complimentary item: price set to 0 on the bill with a "COMP" label; reason required; logged under the cashier.
4. Cancellation of an entire order follows the same void lifecycle as individual item voids (D10).
5. All of the above require the appropriate role permission and are immutably logged in the audit log.

---

#### Payments and cash

**[P1] Payments at checkout**

*As a cashier, I want cash, card and wallet payments, tips, service charge and discounts on the bill.*

Acceptance criteria:
1. Checkout always displays all configured payment options: cash, card (manual entry), QR wallet, bank transfer.
2. Multi-split: any number of payment methods on one bill; the bill cannot be closed until the total is fully covered.
3. Tips: cashier enters tip amount; allocation to staff or to the house is configurable per restaurant.
4. Service charge: configurable percentage, auto-added to bill; can be removed by a role with the service-charge-remove permission, with reason logged.
5. Discount: fixed amount or percentage; reason required; requires discount permission; logged under the cashier.
6. Card payment: cashier enters the amount approved by the external terminal; the POS does not communicate with the terminal.
7. Wallet/QR payments that require internet show "unavailable" when internet is down; all other methods remain available.

In scope (P1): manual card amount entry; graceful wallet degradation.  
Out of scope (P1): direct card terminal integration (post-pilot); automatic wallet reconciliation (P2).

Edge cases:
- Partial payment entered (less than bill total) → remaining balance shown; bill cannot close until balance is 0 or explicitly moved to khata/credit (P2).
- Tip exceeds configurable threshold (e.g. 20% of bill) → flag; manager acknowledgement required before close.

---

**[P1] Cashier shifts, day open/close, petty cash, Z report**

*As a cashier, I want to open and close my own shift with a float and a blind cash count, and as a manager, I want a day close that aggregates all shifts into a Z report.*

Acceptance criteria:
1. A cashier opens a shift before taking any payment; shift records the opening float (starting cash) entered by the cashier; opening requires the cashier role.
2. Petty cash entries (cash in / cash out) are recorded against the shift with a mandatory reason.
3. Blind cash count at shift close (D21): cashier enters counted cash before the system reveals the expected total; both are shown together with the variance after entry.
4. If the shift variance exceeds a configurable threshold, manager acknowledgement is required before the shift closes.
5. Blind count cannot be skipped; owner-only override to skip is available but always logged.
6. A day is opened before the first shift; day close requires all shifts to be CLOSED and is blocked while any shift is still open (D21).
7. Day-close Z report: combined totals across all closed shifts — sales by payment method, voids, discounts, comps, petty cash entries, expected vs counted cash, and total variance.
8. Day close locks the period; reopening requires manager permission; all activity in a reopened day is logged with a "reopened" flag.

Edge cases:
- Close attempted with open orders → blocked; all tables must be cleared or explicitly overridden by manager (logged).
- Close attempted with pending voids → blocked per D11.
- Day close attempted while any shift is still open → blocked until all shifts are closed.
- Printer offline at Z report time → Z report saveable/exportable as PDF or CSV; prints when printer reconnects.

---

**[P2] Expenses against the day**

*As an owner, I want expenses recorded against the day, so daily profit is visible, not just sales.*

Acceptance criteria:
1. Expenses entered with: amount, category, description, payment method.
2. Daily profit = sales − cost of goods (from recipes, P2) − expenses.
3. Expenses visible on the owner dashboard and in the daily summary.

---

#### Customers and marketing

**[P2] Customer list with order history**

*As an owner, I want a customer list with order history, built from phone numbers at ordering.*

**[P3] Loyalty, vouchers, gift cards, coupon codes**  
**[P3] Targeted offers by WhatsApp or SMS**

*All P3 — acceptance criteria deferred.*

---

#### Delivery and takeaway

**[P2] Delivery orders**

*As a dispatcher, I want delivery orders with address, zone, delivery charge and an assigned rider.*

Acceptance criteria:
1. Delivery order has: customer name, phone, address, zone, delivery charge, and assigned rider.
2. Rider's cash collections are tracked and settled at shift end.
3. Delivery orders join the same station queue as dine-in orders (D4 / same queue principle from E4).

---

#### Staff

**[P1] PIN login on shared devices**

*As staff, I want to log in with my own PIN on a shared device, so every action is tied to me.*

Acceptance criteria:
1. Each staff member has a unique 4–6 digit PIN; duplicate PINs are rejected at setup.
2. PIN authentication is handled by the hub locally; does not require internet. PINs are sent plaintext over the staff network and verified against an argon2id or bcrypt hash on the hub (D28).
3. Every action taken in a session is attributed to the logged-in staff member in the audit log.
4. Auto-logout after configurable idle time (configurable per role; default 5 minutes for order takers — D28).
5. A manager can force-log-out any user from any device; the forced logout is logged.
6. Lockout: 5 consecutive failed PIN attempts for the same staff member lock the account for 15 minutes (configurable); lockout clearable by a manager (D28); lockout event logged to audit log. Per-device rate limit (Group C): ≥ 10 failed attempts from the same device within 5 minutes triggers a 15-minute device lockout regardless of which staff member attempted.
7. PIN distribution (D40): PINs are hashed with argon2id on the setting device before any transmission; the cloud stores only the hash and pushes it to every hub where the staff member works. Adding or resetting a PIN requires internet (P1 limitation; hub cannot create hashes on its own).

Edge cases:
- Device shared across shifts → previous session must be explicitly closed or timed out before a new PIN is accepted.
- Staff device on guest WiFi → hub rejects all auth and command requests from guest-network IP ranges; staff must connect to the staff WiFi (D28).

---

**[P2] Clock-in / clock-out**

*As a manager, I want clock-in and clock-out with hours per staff member, exportable for payroll.*

Acceptance criteria:
1. Staff clock in and out via PIN on any device.
2. Hours per staff member viewable and exportable to CSV.
3. Manager can edit clock records with a reason; original record and edit both preserved in audit log.

---

#### Reports and exports

**[P1] Sales reports and tax report**

*As an owner, I want sales by item, category, hour, staff, order type and payment method, and a tax report.*

Acceptance criteria:
1. Sales report filterable by: date range, branch, item, category, hour of day, staff member, order type, payment method.
2. Tax report: gross sales, tax collected by tax class, net sales; formatted for manual filing.
3. Reports are viewable remotely through the basic P1 owner view (D22); the full analytics dashboard is P2.
4. Reports are read-only; no data editable from the reports view.

In scope (P1): viewing and filtering; tax report for manual filing.  
Out of scope (P1): FBR/authority transmission (post-pilot, D9; PRA conditional per D58); Excel/CSV export (P2); accounting integrations (P2+).

---

**[P2] Report exports**

*As an owner, I want every report exportable to Excel or CSV.*

---

#### Hardware and system

**[P1] Printers, cash drawer, multiple terminals**

*As an admin, I want cash drawer kick, receipt and kitchen printers by station, and multiple terminals on one hub.*

Acceptance criteria:
1. Each station is configured with a thermal printer, a KDS screen, or both.
2. Cash drawer is triggered automatically on every cash payment close.
3. Any number of tablets or phones can connect to one hub over local WiFi. Device pairing requires a manager to authenticate at the hub admin panel (`hub:3000/admin`) with their PIN; QR generation is a permissioned action ("manage-devices") and is written to the audit log (D38).
4. If a station's screen goes offline, all pending and incoming tickets for that station auto-print to its printer.
5. Print jobs are written to a persistent queue on the hub, survive power cuts, and print in order after restart.
6. The Windows cashier terminal runs the hub-served app in Chrome or Edge kiosk mode, started automatically at login (D56).

---

**[P1] Automatic backups and restore**

*As an owner, I want automatic local and cloud backups, and to restore a hub from backup in minutes.*

Acceptance criteria:
1. Local backup (D53): automated nightly at the branch's quietest hour (computed from the last 14 days; 04:00 until then; a manager can set a fixed time — D63) to a USB drive attached to the hub; each copy is integrity-checked; the last 7 are kept; success or failure is written to the audit log.
2. Cloud backup: all events synced to cloud on internet return as a gap-free copy (D52); full snapshot taken nightly.
3. Restore target: hub operational from a backup within 15 minutes. A replacement hub for an existing branch is set up with a one-time replace-hub code from the cloud, restores from the old disk, the newest USB backup, or the cloud (in that order), then pulls any missing events from the cloud (D53).
4. Backup status and last successful backup time (local and cloud) visible on the P1 owner view (D22); alert if no backup in > 24 hours.

Edge cases:
- Old hub's disk unreadable and internet was down since the last backup → events after the last backup that never reached the cloud are lost; the restore screen states this window explicitly.
- Restore from the cloud only → all devices must be re-paired (device tokens are never synced to the cloud); restore from disk or USB keeps pairings.
- USB drive missing or full at backup time → BackupFailed logged; owner view alert.

---

**[P1] Receipt and ticket templates**

*As an admin, I want editable receipt and kitchen ticket templates, including logo, tax number, footer message and language.*

Acceptance criteria:
1. Receipt template configurable fields: logo (image upload), restaurant name, address, tax/NTN number, footer text, language (English in P1).
2. Kitchen ticket template configurable fields: station name, table number / order type, item name, modifiers, item notes, timestamp, order ID.
3. Templates editable from the back-office UI with a live preview before saving.
4. Template changes take effect on the next print job; existing queued jobs are unaffected.

In scope (P1): English templates, configurable fields above.  
Out of scope (P1): Urdu/Arabic or RTL templates (post-P1, D12).

---

### E1. Restaurant model and setup

**[P1] Floors, tables, and stations**

*As a setup admin, I want to draw my floors and place stations on them, so that the system knows where things physically happen.*

Acceptance criteria:
1. Admin creates floors; each floor has a name and a 2D layout canvas for placing tables and stations.
2. Tables: table number/name, seating capacity, shape (square / round / rectangle), floor position.
3. Stations: name, type (slot or batch — D13), capacity, floor and position.
   - Slot station capacity = maximum number of items cooking concurrently.
   - Batch station capacity = maximum number of items per load.
   - Each batch station defines one or more cook programs (name + cook time, e.g. "Fry 180 °C, 6 min"); a load runs one program, and only items with the same program share a load (D49).
   - A manager can override a station's capacity live during service without restarting (D37); the override triggers immediate recalculation for affected reservations and emits slip warnings to displaced orders.
4. Each batch station has a freshness window (configurable duration, default 0 = no items pulled in early — D17).
5. Floors, tables, and stations can be renamed, repositioned, and archived; archived entities are preserved in history.
6. An archived station that still has in-progress tickets shows a warning; the tickets complete normally.

Edge cases:
- Two stations with the same name on different floors → allowed; identified by floor + station name.
- Station removed while orders are in-flight → warn admin; existing tickets for that station run to completion before archive takes effect.

---

**[P1] Menu item recipe route**

*As a setup admin, I want to define each menu item's recipe route, so that orders reach the right stations.*

Acceptance criteria:
1. Each item has: primary station (required), optional prep buffer (duration added before the station fires), cook time at the primary station, and serve mode (immediate or sync — D16). Default serve mode is configurable per item at setup; can be overridden per modifier.
2. Stock time: a separate, shorter cook time used when pre-cooked stock > 0; engine switches automatically to full cook time the moment stock reaches 0 (D7).
3. Modifiers (variants, add-ons) can independently override: price, cook time, and/or station.
4. Items can be marked batchable (yes/no); batchable items at a batch station are grouped per D14. An item routed to a batch station selects its cook program, and optionally a separate program for reheating pre-cooked stock (D49).
5. Prices are entered and stored as integer minor units (paisa); the UI formats them for display (D47).

In scope (P1): single primary station + optional prep buffer + stock time.  
Out of scope (P1): multi-station chains where an item passes through two or more stations in sequence (P2+; schema ready from day one).

Config snapshot (D25): when an order is placed the hub snapshots each item's cook time, station, serve mode, prep buffer, batch program (D49), price (integer minor units — D47), and tax class into the OrderPlaced event. Menu changes after that point do not affect in-progress orders.

Edge cases:
- A modifier overrides station to an unconfigured station → validation error; must select a configured station.
- Stock time = 0 (pre-plated, serve immediately) → valid; item is served from stock with zero wait at the station.
- Batchable item assigned to a slot station → treated as a non-batch item (slots fire individually).

---

**[P1] Pre-cooked stock — daily entry**

*As a manager, I want to set today's pre-cooked stock per item, so that early orders get the fast time.*

Acceptance criteria:
1. Manager enters pre-cooked stock count per item at the start of service; count can be updated any time during service.
2. Live countdown displayed: to the manager (manager view) and to order takers on the ordering screen (e.g. "4 karahis left").
3. Stock is reserved only at order submit, not during order building (D7).
4. Race condition: if two orders submit simultaneously for the last unit, first-submit-wins; the second submitter immediately sees a corrected ETA using the full cook time.
5. When stock reaches 0, the item switches to "slow" mode on all ordering and customer-facing screens.
6. If no stock count is entered for an item, it defaults to 0 (full cook time always used).

---

### E2. Ordering and tables

**[P1] Table management and order types**

*As an order taker, I want to tap a table and see the menu, so that I can take an order in seconds.*

Acceptance criteria:
1. Table states and their floor-map colors: free (white), seated (blue), ordered (yellow), food-on-table (green), bill-requested (orange), needs-cleaning (grey). Colors configurable per restaurant. The food-on-table state is set when the first item in the order is marked served (runner delivers / waiter marks served) — not when it is marked Done at the station (D31).
2. Opening a table fires an event; all devices reflect the lock immediately (color change + name of who opened it — D5).
3. A locked table blocks creating or editing orders only (D39). Marking items served, requesting the bill, closing the bill, and marking the table as needing cleaning are allowed with the relevant role permission regardless of who holds the lock. Exception for order creation/editing: a user with the "take order anywhere" permission can open any table regardless of lock.
4. Order takers are assigned to floors or specific tables by default; assignments managed by manager.
5. Force-release lock: manager can release a lock from any device; the release is logged.
6. While the order screen is open, the device keeps the lock alive (at most one refresh per minute, D61), so a long order is not lost to the lock TTL.
6. Move table: transfers the live order to another free table; logged with reason.
7. Merge tables: combines two live orders under one table number; all items and their existing ETAs are preserved.
8. Split table: divides items across two new table numbers for separate billing; each split becomes an independent bill.
9. Order types at opening: dine-in (table), takeaway (counter number), parking (car description), delivery (address + rider), web.

Edge cases:
- Merge attempted on a table with a pending void → blocked until the void is resolved.
- Device that opened a table crashes → the lock auto-releases when the holder's session expires or after the lock TTL (default 10 minutes, D51); a manager can force-release sooner; both are logged.
- "Needs cleaning" state → set by runner or waiter after customer leaves; blocks new seating until a manager or cleaner clears it.
- Table lock during hub outage (P4 scope) → handled per D15.

---

**[P1] Adding items to a running order**

*As an order taker, I want to add items to a running order, so that a table can keep ordering through the meal.*

Acceptance criteria:
1. Each addition is a new independent order with its own ETA; it does not affect the timing of previously submitted items (D2).
2. The order taker sees a live ETA preview as items are added; ETA is locked at submit (D7).
3. New items fire to the kitchen immediately on submit.
4. All sub-orders for a table are grouped and visible on the table view, sorted by submission time.

---

**[P1] Per-item ETA preview at ordering**

*As an order taker, I want to see a per-item ETA while I'm taking the order, so that I can tell the customer an honest time before I submit.*

Acceptance criteria:
1. ETA updates live as items are added to the order-building screen (within 1 second per item added).
2. Each item shows its individual expected ready time; items in the list are sorted earliest to latest.
3. ETA formula: prep buffer + station queue wait + item cook time (using stock time if stock > 0, full cook time otherwise).
4. Station queue wait accounts for: current items cooking, items queued ahead, station capacity (slot or batch type).
5. ETA is a preview — no stock is reserved at this point (D7).
6. Once submitted, the ETA is locked and visible on the table view and (when applicable) the customer tracking page.

Edge cases:
- Item added when station is at full capacity → ETA reflects the wait for the next free slot or next batch fire.
- Very long queue → ETA shown as an absolute clock time (e.g. "10:47 PM"), never truncated or approximated.

---

**[P1] Sold out and slow items**

*As an order taker, I want to see items that are sold out or slow right now, so that I don't promise what we can't deliver.*

Acceptance criteria:
1. Sold out (item marked unavailable): greyed-out with a "Sold out" label; cannot be added to an order.
2. Slow (pre-cooked stock = 0 and full cook time exceeds a configurable threshold): shown with a clock icon and the estimated full cook time; still orderable.
3. Both states update in real time on all devices; latency < 5 seconds.

---

### E3. Kitchen display and printing

**[P1] Station KDS screen**

*As a cook, I want a screen for my station that shows what to cook next, so that I always know the order of work.*

Acceptance criteria:
1. Any device opens a station KDS view by URL (web-based); one view can show a single station or all stations. ⚠️ Changed by 03b v1.0.1 (S-1, editorial): the "all stations" view is the **assembler view per point** on the Pass tablet (03b §3.4); a KDS shows one station.
2. Tickets are sorted by latest-start time (when the item must fire to meet its promised ETA), not by order submission time. ⚠️ Changed by 03b v1.0.1 (S-1): the order is the **03a engine contract** (Now / Next / Later, `stationView`), which 03b only shows.
3. Each ticket displays: item name, modifiers, item notes, table number / order type, target land time, and a countdown to latest-start. ⚠️ Changed by 03b v1.0.1 (S-1): times and countdowns come from the 03a contract (`stationPlan`).
4. "Start" and "Done" are large tap targets; no confirmation dialogs for normal operation (usable with greasy hands).
5. New ticket alert: configurable audio alert (volume per station) + ticket color change. ⚠️ Changed by 03b v1.0.1 (S-1): the volume is set per station on the hub admin "Kitchen screens" page (`SetStationScreen`, 03b §3.8).
6. Late ticket: color changes to red; slip warning dispatched to the order taker's device.
7. Boosted ticket: distinct visual marker (e.g. highlighted border); sorted to top of queue.
8. Batch station view: shows the current batch load, items in the next pending batch, and the fire countdown.
9. Each station has a completion mode set by admin (D43): two-tap (Start + Done), single-tap (Done only), or auto-done (Start only). The default per station type comes from the tap-rate field test (OQ4).
10. Sync items marked Done before the rest of their order show "HOLD AT PASS" until the order's last sync item is Done (D36, D42).

In scope (P1): web-based KDS, English labels, slot and batch station views.  
> ⚠️ Changed by 03b v1.0.1 (S-1, R-1): **screen-first** — the KDS screen is the station's main surface; the printer is an optional accessory (03c), not the backup the cook depends on.  
Out of scope (P1): audio callouts in other languages (P3).

Edge cases:
- Cook taps Done before Start → warning shown; Start must be tapped first unless the station's completion mode is single-tap (D43, which replaces the old "skip-start" option).
- Station in auto-done mode (D43, D60) → Done is applied automatically at the planned end unless tapped earlier; the ticket moves to the pass on its own; a late Done tap is rejected as already done.
- Station in single-tap mode (D60) → the item shows as started the moment it is fired.
- Multiple cooks at one station → each tap is logged under the logged-in cook.
- KDS screen goes offline → auto-print fallback activates for that station (see E3 printing story below).

---

**[P1] Thermal printing — station tickets**

*As a cook, I want tickets to print on my station's thermal printer, so that I can work even if the screen dies.*

Acceptance criteria:
1. Each station is independently configurable as: screen only, printer only, or screen + printer.
2. When a station's screen is detected as offline, all pending and incoming tickets for that station are automatically sent to its printer.
3. Print jobs are written to a persistent queue on the hub; they survive power cuts and print in submission order after restart.
4. Reprint of any ticket is available to users with the reprint permission; every reprint is logged.

Edge cases:
- Printer runs out of paper mid-rush → job stays in queue; prints when paper is replaced; printer-offline alert shown to manager.
- Screen + printer both configured: Done tap on screen cancels the queued print if the ticket has not yet printed; if already printed, a strikethrough reprint is issued.

---

**[P1] Counter receipt**

*As a cashier, I want bills and receipts printed on the counter printer, with the restaurant's logo, tax details and a QR for order tracking or feedback.*

Acceptance criteria:
1. Bill printed on request; receipt printed automatically on payment close.
2. Bill shows: all items (pending-void items shown with a "PENDING VOID" label and excluded from the total per D11), subtotal, service charge (if any), tax breakdown by tax class, and total.
3. Receipt shows: all bill fields above, payment method(s) with amounts, and change due. The order-tracking QR code is omitted in P1 (D20); it is added to the receipt template when the customer tracking page ships in P2.
4. Receipt template is fully configurable per D9 (logo, tax number, footer text).

---

**[P3] Audio callouts**

*As a cook, I want audio callouts in my language, e.g. "Table 5 karahi ready", because kitchens are loud.*

*Deferred to P3.*

---

### E4. Timing engine

**[P1] ETA calculation**

*As an order taker, I want the system to calculate when each item will be ready, so that the promise I make is real.*

Acceptance criteria:
1. ETA = prep buffer + station queue wait + item cook time (stock time if stock > 0, else full cook time).
2. Station queue wait:
   - Slot station: time until a slot frees (based on items currently occupying slots and items queued ahead).
   - Batch station: time to the next batch fire that this item can join within the freshness window; if no batch fires within the window, time to the next batch fire after the window.
3. Pre-cooked stock: stock time used per item until stock = 0; switch to full cook time is automatic and immediate (D7).
4. All order types (dine-in, takeaway, parking, delivery, web) share the same station queue; no order type has default priority.
5. ETA is recalculated on every relevant event: new order submitted, item started, item done, item voided, boost applied, stock count updated.

In scope (P1): single primary station, slot and batch station types, pre-cooked stock, reservation-timeline ETA model (D27).  
Out of scope (P1): multi-station chains (P2+); learned/adaptive cook times (P2).

Engine model (D27): the engine maintains a reservation timeline per station (planned startsAt/endsAt per item or batch) rather than a simple FIFO queue. Station queue wait = earliest time a slot opens in the timeline. This avoids systematic under-estimates when items have different cook times.

Prep buffer (D35): the prep buffer does not occupy the station. Station reservations cover only `[start + prep, start + prep + cook)`. Prep time is included in the ETA but does not block other items from using the station.

Overrun handling (D33): if an item is still COOKING past its planned station end, its live end time = `max(planned_endsAt, now)`. Subsequent capacity checks account for this live end; ETAs for items behind the overrunning item adjust automatically.

Tap dependency (D43): overrun handling, the overrun cascade (D42) and hold at pass depend on cooks tapping reliably. They are built after the tap-rate field test (OQ4) and work in any station completion mode. ETA calculation, reservations and hold-and-fire do not depend on taps and are built first.

Recorded actions (D44): every fire, overrun shift, slip warning and automatic lock release is written as an event before it takes effect. A fire is never sent twice, including after a hub restart.

Edge cases:
- Station at zero available capacity → ETA shows time to next available slot or next batch fire.
- Order submitted during brief hub restart → device queues the submit event; ETA is calculated when the hub acknowledges replay.

---

**[P1] Hold-and-fire dispatch**

*As a cook, I want the system to tell me when to fire each item (hold-and-fire), so that items in one order land together and hot.*

Acceptance criteria:
1. Each order's target land time = the latest ETA among all sync items in that order at submit time (D16). Immediate items are not included in this calculation; each immediate item fires at its own individual ETA. Target land times are fixed at submit and recalculated only on void, boost, stock count update, or station capacity change (D23, D37).
2. Each item's latest-start time = target land time − cook time − prep buffer. Station reservation = `[latest_start + prep, target_land_time)` — prep is off-station (D35).
2a. Intra-order collisions (D36): before computing sync intervals, immediate items are tentatively reserved on their stations; these tentative intervals count against capacity in sync checks. Same-station sync items are serialised (longest-cook-first): each item's station interval starts where the previous ends; individual land times are staggered; the order's target_land_time = the latest individual land time.
3. The engine dispatches a "fire now" event to the station KDS at each item's latest-start time.
4. **Batch stations (D14, D17):** at fire time, the engine pulls in other pending batchable items for the same station whose target land times fall within the freshness window, filling available capacity. A freshness window of 0 means no additional items are pulled in; each batch fires for the earliest-deadline item only.
5. **Boost (D3):** a boosted order's target land time is set to "as soon as possible" (next available slot or batch); its latest-start time becomes now; all orders displaced in the queue receive automatic slip warnings to their waiters.
6. "Fire now" appears on the KDS as a countdown and an audio + visual alert.
7. Nothing in the engine is hardcoded to a specific item (karahi, roti) or station (stove, tandoor).

Edge cases:
- Item submitted just before a batch fires → item joins that batch only if its target land time is within the freshness window; otherwise it waits for the next batch.
- Boost causes a batch to fire early → items already included in that batch fire early (they land early or on time, not late); only orders bumped from the queue get slip warnings.
- Void of an item in-flight → latest-start times of remaining items in that order are recalculated; target land time may move earlier.

---

**[P1] Slip warning**

*As a waiter, I want an early warning when an order is slipping, so that I can inform the customer before they complain.*

Acceptance criteria:
1. Slip threshold: configurable per restaurant (default 5 minutes); measured as (current estimated land time) − (original promised land time).
2. Push notification sent to the order taker's device: "[Table X] [Item name] is running [N] minutes late — let the customer know."
3. Waiter can tap "Customer informed" to dismiss; unacknowledged slip warnings escalate to the manager after a configurable time.
4. Multiple slipping items on the same table → grouped into one notification per table, not one per item.
5. Customer-facing tracking page: shows original promised time + "Running [N] minutes late" notice (D6); original time is never silently replaced.

Edge cases:
- Waiter device is offline when warning fires → notification queued; delivered when device reconnects.
- Slip warning triggered by a boost on another order (cascaded displacement — D3) → notification text is the same; no mention of the reason.

---

**[P2] Learned cook times**

*As an owner, I want the system to learn real cook times from start and done taps, so that ETAs get more accurate over time.*

Acceptance criteria:
1. System records the actual cook duration (Done time − Start time) per item, per station, per time-of-day slot (configurable slot width, e.g. 1-hour buckets).
2. Owner dashboard shows: configured cook time vs measured average and spread per item/station/slot.
3. System generates a suggested updated cook time when the measured average differs from the configured value by more than a configurable threshold.
4. Suggestions require admin approval before they take effect; every approved or rejected suggestion is logged.

---

### E5. Offline and sync

**[P1] Fully offline operation**

*As an owner, I want the restaurant to run fully without internet, so that an outage never stops service.*

Acceptance criteria:
1. All of the following work with no internet (hub on local WiFi only): ordering, table management, KDS, printing, billing, and cash payments.
2. Card payments: the terminal's own SIM handles the transaction; POS records the amount manually (D8).
3. Events are appended to the hub's local event store during the outage.
4. On internet return, events sync to the cloud in order; sync is idempotent (replaying the same event twice has no effect); no orders are lost; no duplicates are created.
5. Cloud sync status and last-successful-sync time are visible to the manager; an "offline" indicator appears when internet is down.

In scope (P1): internet-down scenario (hub still running).  
Out of scope (P1): hub-down failover (P4); customer QR tracking offline behaviour (P2, covered in E9 — D20).

Edge cases:
- Internet returns mid-rush → sync runs in the background with no interruption to service.
- Clock skew between a device and the hub → hub clock is canonical; device timestamps are corrected on sync.
- Hub clock wrong after boot (e.g. dead RTC battery) → hub never runs earlier than its newest event; ClockAlarm banner on admin and KDS; service continues (D48).
- Hub clock drifts from cloud time by more than 60 s → ClockAlarm raised; offset recorded on each sync (D48).
- Cloud detects a gap in the hub's event sequence → batch rejected; hub resends from the cloud's last received event; nothing is skipped (D52).

---

**[P1] Device resilience during hub restart**

*As a waiter, I want my tablet to keep working if the hub restarts, so that I don't lose an order mid-rush.*

Acceptance criteria:
1. Each device queues unacknowledged events locally while the hub is unreachable.
2. On hub return, the device replays queued events in timestamp order.
3. No order is lost during a hub restart that completes within a configurable window (default 5 minutes).
4. The device shows a "Reconnecting…" indicator; no "Order submitted" confirmation is shown until the hub acknowledges the event.

Edge cases:
- Device goes offline while an order is being built (not yet submitted) → order-in-progress is preserved locally and can be submitted when the device reconnects.
- Hub outage exceeds the safe window → manager is alerted; devices continue queuing but may accumulate conflicts (P4 resolution per D15).

---

**[P1] Hub restart after power loss**

*As an owner, I want the hub to restart and resume full operation automatically after a power cut, so that the restaurant does not need technical support to recover.*

Acceptance criteria (D24):
1. Hardware prerequisites (installation): SSD storage, BIOS "power on after AC loss" enabled, hub and kitchen printers on a UPS (target: 15-minute coverage), RTC battery checked or replaced, NTP configured, USB backup drive attached (D48, D53).
2. Hub service starts automatically on OS boot (systemd); no manual action required.
3. Durability: the hub acknowledges a device event only after it is durably committed to SQLite (WAL, `synchronous=FULL`); devices that do not receive an ack resend the event on reconnect; idempotent event IDs prevent duplicates.
4. Recovery: on startup the hub applies any pending migrations, loads the latest engine snapshot, replays all events with seq > snapshot.last_seq, and rebuilds all projections from the event log (open orders, table locks, stock counts, station queues). A snapshot written by a different engine version is ignored, and the hub replays the full log instead (D62).
5. Missed fire events: any item whose latest-start time has already passed at startup and that was never dispatched is dispatched as "fire now" immediately; items already fired before the outage are not fired again (their tickets are reprinted from the print queue, D44). If an order's target land time has also passed, a slip warning is sent to the order taker.
6. Late device taps: Start/Done taps from a device's reconnect queue are accepted with the device's `occurred_at` timestamp; the hub records its own `recorded_at` separately.
7. Print queue: resumes in order; any job that was sent but not confirmed by the printer is reprinted with a "REPRINT" header line (duplicate ticket acceptable; missing ticket is not).
8. Devices reconnect automatically; KDS screens re-render the current station view without manual refresh.
9. Restart event written to audit log: hub_down_at (= last heartbeat from `hub_heartbeat` table, written every 60 s while running — D41), hub_up_at, events_replayed count, missed_fires count.
10. Target: hub fully operational within 90 seconds of power returning under normal conditions.

Edge cases:
- Power returns during an active rush → missed fires dispatched immediately; station staff see "FIRE NOW" on KDS; slip warnings sent for all orders whose promises are now at risk.
- Printer comes back before the hub → printer reconnects to hub print queue when hub is ready; no manual requeue needed.
- Device replays an event the hub already committed → hub's idempotency check (`INSERT OR IGNORE` on event_id) prevents the duplicate; device receives the original ack.

---

**[P4] Hub failover**

*As an owner, I want another device to take over if the hub dies completely, so that there is no single point of failure.*

*Deferred to P4. Table-lock conflict resolution during hub-down is per D15.*

---

### E6. Roles, permissions, and rules engine

**[P1] Custom roles and permissions**

*As an owner, I want to create any number of custom roles, so that permissions match my actual staff.*

Acceptance criteria:
1. Owner creates roles with a name and a set of permissions.
2. Granular permission list includes at minimum: void-item, move-item-to-stock, mark-item-returned, apply-discount, apply-refund, apply-comp, reopen-bill, edit-menu, view-reports, take-order-anywhere, boost-order, approve-void, force-release-table-lock, reprint-ticket, view-audit-log, manage-roles, manage-staff.
3. Each role-level permission is set to: allowed, requires-approval (from a specified role), or not granted. "Denied" exists only as an owner-set override on an individual staff member and always overrides all role grants (D19).
4. A staff member can be assigned one or more roles; effective permission = most permissive grant across all roles: allowed > requires-approval > not granted (D19). An explicit "denied" can be set only by the owner on an individual staff member and always overrides all role grants.
5. Role assignments and permission changes are logged in the audit log.
6. A default role set is provided at initial setup; the owner can modify or replace it entirely.
7. At least one admin role must always exist; removing the last admin role is blocked.

Edge cases:
- Staff member assigned two roles where one allows and one requires-approval → allowed wins (most permissive). "Denied" is not a role-level setting; it is an individual-level owner override only (D19).
- Owner attempts to remove their own admin role → blocked with a clear message.

---

**[P1] Item lifecycle enforcement**

*Items move through five stages; the action available at each stage depends on the actor's role.*

Acceptance criteria (per D10):

| Stage | Who can act | Action available |
|-------|-------------|------------------|
| Added; cooking not started | The person who added the item | Remove — no approval needed; item removed from kitchen queue immediately; reserved pre-cooked stock released back to pool (D18) |
| Cooking started | Role with void permission | Void (with reason, required); item enters ready stock pool or wastage log — reserved pre-cooked stock is NOT returned to the pre-cooked pool (D29 corrects D18 for stage 2) |
| Cooking started | Role with move-to-stock permission | Move to ready stock |
| Cooked; not yet served | Role with move-to-stock permission | Move to ready stock — item enters the ready stock pool and can be reassigned to another order |
| Served | Role with mark-returned permission | Mark as returned (reason required); item goes to wastage log or staff meal log |
| Served (resell flag) | Owner-enabled only | Resell the served item — off by default; must be explicitly enabled by owner |

Note (D29): the engine's FireNow dispatch event does NOT advance an item to stage 2. Stage 2 begins only when kitchen staff tap Start on the KDS. This means an item can be in stage 1 (ADDED) after it has been fired to the screen.

All stage transitions are logged with: actor, timestamp, reason, item ID, and order ID.

---

**[P1] Pending void on bill and table close**

*(D11 — enforcement story)*

Acceptance criteria:
1. A void request that requires approval shows on the bill as "PENDING VOID" and is excluded from the bill total.
2. Every user whose role includes the approve-void permission receives an urgent push notification.
3. The table cannot be closed for billing while any void on it is in pending state.
4. Exception: a restaurant can configure a timeout-override rule (off by default) — if no approver acts within N minutes, the table can be closed by a manager, and the event is logged.
5. Approved void: item removed from bill, approval reason logged.
6. Rejected void: item reinstated on bill at full price, rejection reason logged, waiter notified.

---

**[P3] Rules engine (When / If / Then)**

*As an owner, I want to write rules as When / If / Then, so that my process runs without me watching.*

*Deferred to P3 — full acceptance criteria not scoped here.*

---

**[P3] Pending approvals queue**

*As a manager, I want a pending queue for approvals, with a reason required on every approve or reject.*

*Deferred to P3.*

---

**[P1] Immutable audit log**

*As an owner, I want every sensitive action logged with who, when and why, and that log can never be edited.*

Acceptance criteria:
1. Audit log is append-only; no role (including owner) can delete or modify an entry.
2. Logged actions include: every item-lifecycle transition, void/refund/comp/discount, role/permission change, boost, day open/close/reopen, bill override, force-release table lock, reprint, staff clock-in/out.
3. Each log entry contains: actor ID + name, timestamp (hub clock), action type, target entity ID, reason (where required), and outcome.
4. Log is viewable by the owner and any role with the view-audit-log permission; filterable by date range, staff member, and action type.
5. Log is exportable to CSV.

---

### E7. Floor operations and staff

**[P3] Zone assignment**

*As a manager, I want to assign staff to zones and floors, so that the system knows who covers where.*

**[P3] Live heatmap**

*As a manager, I want a live heatmap of workload by zone, so that I can move helpers to where traffic is.*

Acceptance criteria (P3):
1. Heatmap built from pending tasks and table activity; no GPS or beacons required.
2. "Blackout warning": alerts when a zone will have no staff if a runner currently in it leaves.

**[P3] Runner dispatch**

*As a runner, I want to be told the next pickup and where to take it, so that food doesn't sit at the pass.*

Acceptance criteria (P3):
1. Ready items are assigned to the nearest available runner, considering floor and zone.

**[P4] Shift scheduling and attendance**

*Deferred to P4.*

---

### E8. Billing and payments

**[P1] Split bills and mixed payments**

*As a cashier, I want to split bills by item, by person or by amount, and take mixed payments.*

Acceptance criteria:
1. Split by item: cashier selects which items appear on which split.
2. Split by person: cashier assigns items to seats (by seat number or name).
3. Split by amount: cashier enters amounts that must sum to the total; all amounts are integer paisa (D47), so a remainder is always a whole number of paisa and must be explicitly assigned.
4. Mixed payments: any combination of payment methods across any split; each payment is logged separately.
5. A bill cannot be closed until all splits are fully paid.

Edge cases:
- Customer disputes one item after splitting → that split can have a void/adjustment applied independently, following the item lifecycle (D10).
- Receipt printer offline at bill close → cashier can share bill via QR link; print when printer reconnects.

---

**[P1] Shift close and day-close Z report**

*As a cashier, I want to close my shift with a blind cash count, and as a manager, I want a day close that aggregates all shifts into a Z report.*

Acceptance criteria (D21):
1. Each cashier shift is closed independently with a blind count: cashier enters counted cash before the system reveals the expected total; variance is shown after entry.
2. If the shift variance exceeds a configurable threshold, manager acknowledgement is required before the shift closes.
3. Blind count cannot be skipped; owner-only override to skip is available but always logged.
4. Day close requires all shifts to be CLOSED; day close attempted while any shift is still open → blocked.
5. Day-close Z report: combined totals across all closed shifts — sales by payment method, voids, discounts, comps, petty cash entries, expected vs counted cash, and total variance.

Edge cases:
- Day close attempted while any shift is still open → blocked until all shifts are closed.
- Multiple cashiers share one day (shift handover) → each closes their own shift; day close available once all shifts are closed.

---

**[P2] Khata (credit) accounts**

*As an owner, I want khata accounts for regulars and nearby businesses, with balances, limits and reminders.*

*Deferred to P2.*

---

**[P1] Tax-compliant invoices**

*As an owner, I want invoices reported to the tax authority automatically, with the integration pluggable per country or province.*

Acceptance criteria (P1 scope only — D9, D58):
1. Every bill shows: tax/NTN number, itemised tax amount per tax class, total tax, and total including tax.
2. Tax is calculated per item using the item's assigned tax class; rounding method is configurable per restaurant.
3. Tax report (see E0 reports) covers all closed bills in a date range for manual filing.
4. The integration architecture is pluggable: a country-specific module can be added without changing core billing logic.
5. Conditional on OQ15 (D58): if Arif Chatkhara must issue PRA-integrated invoices, every closed bill is posted to PRA e-IMS through a durable hub fiscal queue, and the receipt carries the PRA invoice number and QR code. Offline behaviour (print first and post later, or wait for PRA) follows PRA's rule, confirmed in OQ15.

In scope (P1): compliant receipt format + tax report for manual filing; PRA e-IMS transmission only if OQ15 says it is mandatory (D58).  
Out of scope (P1): FBR transmission or any other authority integration (post-pilot).

---

**[P2] Local payment methods**

*As a cashier, I want local payment methods built in, such as QR wallets and bank transfer, plus cards, with reconciliation at shift close.*

*Deferred to P2.*

---

### E9. Customer-facing

**[P2] QR order tracking**

*As a parking or table customer, I want to scan a QR or get a WhatsApp link, so that I can track my order and its ETA live.*

Acceptance criteria (D1, D6):
1. A QR code is printed on the receipt and optionally shown on the table; it carries the internet URL for the order tracking page.
2. The tracking page shows: order items, per-item status (queued / cooking / ready / served), original promised ETA per item.
3. If the order is slipping: "Running [N] minutes late" notice is shown alongside the original time; the original time is not removed or replaced.
4. When internet is down: internet URL is unavailable; the local WiFi URL (hub-served) works for customers who join the restaurant's WiFi. The page prompts the customer to join WiFi and shows the network name.
5. Both URLs are generated at order submit; both are included on the receipt (internet URL as QR, local URL as plain text or second QR).

---

**[P2] Customer add items from phone**

*As a customer, I want to add items from my phone, with a confirmation step, and see the new ETA before I confirm.*

Acceptance criteria:
1. Customer browses the menu and adds items; a confirmation screen shows the items and their new ETA before final submission.
2. Confirmed addition creates a new independent sub-order (D2) and fires it to the kitchen.
3. Customer's tracking page updates to include the new items and their ETAs.
4. Add-from-phone is available only while the order is in an active state (not after bill requested or table cleared).

Edge cases:
- Customer attempts to add items while the order taker has the table locked → addition is queued and fires as soon as the table is unlocked, or a "customer channel" permission allows the addition to bypass the lock (policy decision, configurable per restaurant).

---

**[P2] Customer messaging**

*As a customer, I want to message the waiter who took my order, or call the waiter / ask for the bill from my table.*

*Deferred to P2.*

**[P3] Per-item feedback**  
**[P3] Returning customer recognition**

*Deferred to P3.*

---

### E10. Stock, prep, and wastage

**[P1] Live pre-cooked stock countdown**

*As a manager, I want a live countdown of pre-cooked stock, e.g. "4 paye left", that also hides or slows the item on web and QR ordering when it runs out.*

Acceptance criteria:
1. Manager view shows per-item pre-cooked stock count in real time.
2. Ordering screen shows the count to order takers (e.g. "4 left").
3. When count reaches 0: item switches to "slow" mode on all ordering and customer-facing screens; it shows the full cook time, not the stock time.
4. Web / QR ordering: when stock = 0, the item shows the full cook time (it is not hidden unless it is also marked unavailable).
5. Stock deducted at submit (D7); first-submit-wins on simultaneous last-unit claims. Every stock change is an event (stock set, reserved, released); the live count is derived only from those events (D50).
6. When an item is voided at stage 1 (D10, D18), its reserved pre-cooked stock unit is returned to the pre-cooked pool immediately; the countdown increments. At stage 2, void moves the item to ready stock or wastage (D29); the pre-cooked pool is not restored.

---

**[P3] End-of-day wastage log**

*As a manager, I want to log end-of-day wastage per item, so that cooked-but-unsold food is visible.*

*Deferred to P3.*

---

**[P3] Prep forecast**

*As a manager, I want a prep forecast for tomorrow, so that I pre-cook the right amount.*

Acceptance criteria (P3):
1. Forecast based on: day of week, recent sales trend, upcoming holidays and special events (configurable calendar).
2. Shown as a suggested pre-cook quantity per item; manager can adjust and save as the prep plan for the day.

---

**[P2] Ingredient-level inventory**

*As an owner, I want ingredient-level inventory linked to recipes, with low-stock alerts and purchase records.*

*Deferred to P2 (full set in E0 inventory stories).*

---

### E11. Owner dashboard and analytics

**[P2] Daily closing summary**

*As an owner, I want a WhatsApp or email summary at closing: sales, voids, discounts, late orders, wastage, top items.*

*Deferred to P2.*

---

**[P2] Promised vs actual time**

*As an owner, I want promised vs actual time for every order, so service quality becomes a number I can track.*

Acceptance criteria (P2):
1. Every order records: promised land time (at submit) and actual land time (Done tap on last item).
2. Dashboard shows: average variance per day, per station, per item; trend over time.
3. Orders where actual significantly exceeded promised are highlighted for review.

---

**[P3] Rush replay, menu engineering, leakage alerts**

*Deferred to P3.*

**[P2] Table turn time, peak hours, staff performance**

*Deferred to P2.*

---

### E12. Online, web, and multi-branch

*All P4 — deferred.*

---

### E13. Special modes

**[P1] Interface language and large icons**

*As any staff member, I want the interface in my language with large icons.*

Acceptance criteria (D12):
1. P1: English only on all screens.
2. All UI text is stored in translation keys; no English strings are hardcoded in components.
3. RTL layout is supported in the i18n framework choice but is not activated until a RTL language (Urdu, Arabic) is added (post-P1).
4. Large icons on KDS and ordering screens; every icon has an accompanying text label (no icon-only controls).

In scope (P1): English, large icons, i18n-ready architecture.  
Out of scope (P1): Urdu, Arabic, or any other language.

---

**[P2] Training mode**

*As a new staff member, I want a training mode, where I practise orders without touching real data or printing real tickets.*

Acceptance criteria:
1. Training mode is toggled per device by a manager; a persistent "TRAINING MODE" banner is shown.
2. Orders in training mode appear on the KDS with a "TRAINING" label; they do not print on production printers.
3. Training orders do not affect stock counts, reports, or the audit log (they are logged in a separate training log).
4. Payments in training mode are not processed and not counted in the Z report.
5. Training mode cannot be accidentally left on: it requires an explicit manager disable; a warning fires if training mode is still active at day open.

---

**[P3] Iftar / peak-moment mode**

*As an owner, I want an iftar / peak-moment mode, where pre-orders are scheduled to land at one exact time.*

*Deferred to P3.*

---

### E14. Country packs (market expansion)

*All P4 — acceptance criteria deferred. Architecture: payment methods, tax rules, receipt formats, and regulatory integrations are pluggable modules; the core never contains country-specific logic.*

---

## §4. Open questions

These items are unresolved and must be settled before or during P1 spec writing.

| # | Question | Blocks |
|---|----------|--------|
| OQ1 | Hub hardware: Linux mini PC with SSD and UPS is the target platform (D24). Exact model and budget not yet chosen. Must be confirmed before the installation guide is written. | E5, installation |
| OQ2 | Which tablet model and thermal printer model for the pilot? Affects KDS screen-size assumptions and printer driver selection. | E3 |
| OQ3 | Which card terminal is in use at Arif Chatkhara? Affects the "record manually" UX for the cashier. | E8 |
| OQ4 | **P1 blocker for overrun handling only (D43).** Will kitchen staff tap Start and Done reliably? Overrun handling (D33, D42), hold at pass and P2 learned cook times depend on it. Resolved by a 2-week pre-engine tap-rate field test (tandoor first, then a batch station), which sets each station type's default completion mode. Does not block the engine core. | E3, E4 overrun handling (P1), E4 learned times (P2) |
| OQ5 | Customer add-from-phone with a locked table: should the addition be queued until the table is unlocked, or should a separate "customer channel" permission allow it to bypass the lock? | E9 |
| OQ6 | Pricing model: monthly vs yearly, per branch vs per device — to be decided after 10–15 owner conversations (P3 gate). | E12 |
| OQ7 | Which 3 features do owners outside the pilot say they would pay for? Required input before building any P3 story. | E7, E11, E3 (P3) |
| OQ8 | **Resolved by D22.** P1 includes a basic read-only remote owner view (sales, voids, discounts, payment methods, sync status, backup time). Full analytics dashboard is P2. | — |
| OQ9 | **Resolved by D23.** Target land times recalculate only on void, boost, and stock count update. Re-planning when the queue moves faster than expected is P2. | — |
| OQ15 | **P1 blocker (D58).** Does Arif Chatkhara currently issue PRA-integrated invoices? If yes, PRA integration is required in P1 (and confirm whether PRA allows posting later while offline). Owner: Arslan, to check with the owner or accountant. | E8, P1 scope |
