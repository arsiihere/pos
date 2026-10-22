# Restaurant POS — Product Story & User Stories

Oct 22, 2026 · Arslan Ahmed Arif

## Vision and product story

This is a time-aware restaurant operating system: it tells the customer exactly when each dish will arrive, and then makes the kitchen hit that time.

Every POS today records orders. None of them understands the kitchen as a set of stations with limited capacity, real cook times and pre-cooked stock. So the order taker guesses "15-20 minutes", the customer waits 40, and nobody knows why.

This product models the kitchen the way it actually works. A stove holds 3 karahis. A karahi takes 15 minutes. Six are pre-cooked; after that a fresh one takes an hour. Rotis are fired so they land with the karahi, not before it. From that model the system gives a promise per item, schedules the kitchen to keep it, and warns staff before a promise slips.

Around that engine sits everything a restaurant needs: tables, ordering, kitchen display screens, thermal printing, billing, roles, a rules engine for each restaurant's own process, and an owner dashboard that turns daily operations into patterns the owner can act on.

**Where it starts.** Arif Chatkhara, Lahore, is the pilot. Every feature is battle-tested there on real Friday-night rushes, load shedding and internet outages before anyone else sees it.

**Where it goes.** A subscription product (monthly or yearly) for restaurants in Pakistan first, then any market where restaurants run on stations, rushes and unreliable infrastructure. Nothing in the core is Pakistan-specific: karahi and roti are just examples of items and stations.

**Promise to the owner:** know when every order will be ready, stop leakage (voids, waste, theft), and see where service breaks so it can be fixed.

## Core principles

Five rules every feature must obey. If a feature breaks one, the feature changes, not the rule.

1. **Offline-first, no single point of failure.** The restaurant keeps taking orders, cooking and billing with no internet, in any country. A local hub on the restaurant network is the source of truth; the cloud is a mirror for the owner dashboard, web orders and backups. Tablets queue their own actions if the hub drops and replay them when it returns.
2. **Everything is an event.** Order placed, item started on Stove 2, void requested, payment taken. Events are appended, never overwritten. This gives sync, audit, analytics and rush replay from one design.
3. **Station-agnostic engine.** The system knows stations, capacity, cook times, stock and dependencies. It never knows "karahi" or "roti". A pizza oven, a fryer and a tandoor are all the same thing to the engine.
4. **Process is data, not code.** Each restaurant defines its own floors, stations, roles and approval flows through configuration and a rules engine. No custom builds per client.
5. **Paper and screens both work.** Thermal printers are first-class, not a fallback. Any station can run on a KDS screen, a printer, or both, and fails over from one to the other.

## Personas and roles

These are default roles. Owners can rename them, merge them, or create any number of custom roles with their own permissions.

| Persona | Works on | What they care about |
| --- | --- | --- |
| Owner | Dashboard, phone, WhatsApp summary | Revenue, leakage, wastage, service quality, multiple branches |
| Manager | Tablet, floor heatmap, approvals | Rush flow, staff placement, approving voids and discounts |
| Order taker / waiter | Handheld tablet or phone | Fast ordering, honest ETA to tell the customer, table status |
| Cashier | Counter terminal, printer | Bills, splits, mixed payments, cash drawer at shift close |
| Cook / station staff | Station KDS screen or printer | What to cook next, when to fire it, one-tap start and done |
| Runner / helper | Phone or none | Where to go next, which item to pick up and deliver |
| Customer (dine-in, parking, takeaway) | QR page, WhatsApp, web | When the food arrives, adding items, contacting the waiter |
| Setup admin | Back office | Menu, stations, floors, printers, roles, rules |

## A Friday night, told as a story

This is how one evening feels when the product works. Every sentence maps to a user story below.

**8:45 pm.** The internet goes down. Nobody notices. Tablets keep talking to the hub on the local WiFi, printers keep printing.

**9:00 pm.** A family sits at Table 6 and orders a chicken karahi, 4 rotis and raita. Stove 1 has three karahis on it, all pre-cooked stock is gone. The order taker's tablet shows: raita now, karahi at 9:52, rotis timed to land at 9:52. She tells them "9:52" with confidence instead of "15-20 minutes".

**9:02 pm.** A car pulls into the parking. The runner takes the order on his phone and the customer scans a QR code. Their phone now shows the order and its ETA. They go to the pharmacy next door and come back at the right time.

**9:30 pm.** The tandoor KDS on the top floor is quiet. At 9:44 the hold-and-fire engine lights up "Fire 4 rotis, Table 6". The tandoor cook taps start.

**9:38 pm.** The manager's heatmap shows the ground floor has one person and four pending runs. Two runners are on the top floor waiting. She moves one down with a tap.

**9:41 pm.** A waiter tries to void a Rs 2,400 item. The rule for this restaurant says voids over Rs 1,000 need the manager. The request sits as pending, the manager approves with a reason, and the owner gets a WhatsApp line about it.

**9:47 pm.** Table 9's karahi is slipping by 6 minutes. The waiter gets a nudge to tell the customer before they ask.

**9:52 pm.** Table 6 gets their karahi and rotis together, hot.

**11:30 pm.** Internet returns at some point and everything syncs. At closing the cashier does a blind cash count. The owner, at home, gets the daily summary: sales, voids, late orders, wastage, and the note that tandoor was the bottleneck between 9 and 10.

**Next Friday.** The prep forecast says pre-cook 9 karahis instead of 6, based on the last four Fridays.

## User stories by epic

Each story carries its phase (P1 to P4, see roadmap) and acceptance criteria. Stories are written for any restaurant; Arif Chatkhara examples are only examples.

### E0. Table stakes every restaurant POS has

None of these differentiate the product, but missing any one of them loses the sale.

**Menu management**

- **[P1] As an admin, I want categories, items, variants (half/full, sizes), add-ons and combos/deals**, each with its own price, image, tax class and station route.
- **[P1] As an admin, I want to mark items available or unavailable instantly**, and schedule availability (breakfast menu, weekend-only items).
- **[P2] As an admin, I want price lists by branch, order type and time**, e.g. delivery prices differ from dine-in, happy-hour pricing.

**Orders**

- **[P1] As an order taker, I want to hold or park an order, add order and item notes, reorder a previous order, and reprint any ticket.**
- **[P1] As a cashier, I want refunds, partial refunds, cancellations and complimentary items**, all running through the roles and approvals in E6.
- **[P2] As a host, I want reservations and a waitlist**, with SMS or WhatsApp when the table is ready.

**Inventory**

- **[P2] As a manager, I want ingredients with units and unit conversions**, e.g. bought in kg, used in grams, chicken bought whole and used in pieces.
- **[P2] As a manager, I want recipes (bill of materials) per item, so that every sale auto-deducts its ingredients.**
- **[P2] As a manager, I want suppliers, purchase orders and goods received**, with cost price updating from each purchase.
- **[P2] As a manager, I want stock counts, adjustments and waste entries**, plus a variance report: what should be left vs what is actually left.
- **[P2] As a manager, I want low-stock and expiry alerts**, and par levels that suggest what to buy.
- **[P4] As an owner, I want stock transfers between branches and a central kitchen**, with each transfer tracked both ways.

**Payments and cash**

- **[P1] As a cashier, I want cash, card and wallet payments, tips, service charge and discounts on the bill.**
- **[P1] As a cashier, I want day open and close, cash in and cash out (petty cash), and an end-of-day Z report.**
- **[P2] As an owner, I want expenses recorded against the day**, so daily profit is visible, not just sales.

**Customers and marketing**

- **[P2] As an owner, I want a customer list with order history**, built from phone numbers at ordering.
- **[P3] As an owner, I want loyalty points, vouchers, gift cards and coupon codes.**
- **[P3] As an owner, I want to send offers to past customers by WhatsApp or SMS**, with opt-out respected.

**Delivery and takeaway**

- **[P2] As a dispatcher, I want delivery orders with address, zone, delivery charge and an assigned rider**, and rider cash collection settled at shift end.

**Staff**

- **[P1] As staff, I want to log in with my own PIN on a shared device**, so every action is tied to me.
- **[P2] As a manager, I want clock-in and clock-out with hours per staff member**, exportable for payroll.

**Reports and exports**

- **[P1] As an owner, I want sales by item, category, hour, staff, order type and payment method**, and a tax report.
- **[P2] As an owner, I want every report exportable to Excel or CSV**, and an accounting export (e.g. QuickBooks, Xero) later.

**Hardware and system**

- **[P1] As an admin, I want cash drawer kick, receipt and kitchen printers by station, and multiple terminals on one hub.**
- **[P2] As an admin, I want a customer-facing display and label printing for takeaway packs.**
- **[P1] As an owner, I want automatic local and cloud backups**, and to restore a hub from backup in minutes.
- **[P1] As an admin, I want editable receipt and ticket templates**, including logo, tax number, footer message and language.

### E1. Restaurant model and setup

- **[P1] As a setup admin, I want to draw my floors and place stations on them, so that the system knows where things physically happen.**
  - Floors, tables and stations (tandoor, stove, salad counter, fryer) can be added, named and placed per floor
  - Each station has a capacity (e.g. 3 karahis, 12 rotis per load)
- **[P1] As a setup admin, I want to define each menu item's recipe route, so that orders reach the right stations.**
  - An item can need one or more stations, in order or in parallel
  - Each step has a cook time, and optionally a separate time for pre-cooked or half-cooked stock
  - Modifiers (spice level, extra raita, half/full) can change price, time or station
- **[P1] As a setup admin, I want to mark items as batchable, so that the engine can cook several at once.**
  - Batch size per station (e.g. tandoor takes 12 rotis per load)
- **[P1] As a manager, I want to set today's pre-cooked stock per item, so that early orders get the fast time.**

### E2. Ordering and tables

- **[P1] As an order taker, I want to tap a table and see the menu, so that I can take an order in seconds.**
  - Table states: free, seated, ordered, food served, bill requested, needs cleaning
  - Move, merge and split tables
  - Order types: dine-in, takeaway, parking, delivery, web
- **[P1] As an order taker, I want to add items to a running order, so that a table can keep ordering through the meal.**
- **[P1] As an order taker, I want to see a per-item ETA while I'm taking the order, so that I can tell the customer an honest time before I submit.**
  - ETA updates live as items are added
  - Shows which items arrive first and which last
- **[P1] As an order taker, I want to see items that are sold out or slow right now, so that I don't promise what we can't deliver.**

### E3. Kitchen display and printing

- **[P1] As a cook, I want a screen for my station that shows what to cook next, so that I always know the order of work.**
  - Any screen opens a station view by link; one screen can show all stations or just one
  - Tickets sorted by when they must start, not just when they were ordered
  - One big tap for start and one for done, usable with greasy hands
  - Loud alert and colour change when a new ticket arrives or a ticket is late
- **[P1] As a cook, I want tickets to print on my station's thermal printer, so that I can work even if the screen dies.**
  - Each station can use screen, printer or both
  - If a screen goes offline, its tickets auto-print
  - Print jobs survive power cuts and print after restart
- **[P1] As a cashier, I want bills and receipts printed on the counter printer**, with the restaurant's logo, tax details and a QR for order tracking or feedback.
- **[P3] As a cook, I want audio callouts in my language**, e.g. "Table 5 karahi ready", because kitchens are loud.

### E4. Timing engine (the core)

- **[P1] As an order taker, I want the system to calculate when each item will be ready, so that the promise I make is real.**
  - ETA = queue ahead at that station + time left on what is cooking now + this item's cook time
  - Uses pre-cooked stock first; once stock hits zero, switches to the fresh-cook time automatically
  - Respects station capacity: the 4th karahi waits for the first free slot on the stove
  - Includes delivery and web orders in the same queue, because they use the same stove
- **[P1] As a cook, I want the system to tell me when to fire each item (hold-and-fire), so that items in one order land together and hot.**
  - Items in the same order (or course) share a target land time
  - Each item's latest start = target land time minus its cook time; the engine dispatches a "fire now" event at that moment
  - When several orders need the same batchable station, the engine groups them into the best slot (e.g. 10 rotis for 3 tables in one tandoor load)
  - Generic for any item and any station; nothing is hardcoded to karahi or roti
- **[P1] As a waiter, I want an early warning when an order is slipping, so that I can inform the customer before they complain.**
  - Threshold is configurable (e.g. 5 minutes late)
- **[P2] As an owner, I want the system to learn real cook times from start and done taps, so that ETAs get more accurate over time.**
  - Average and spread per item, per station, per time of day
  - Suggests updated cook times; admin approves before they apply

### E5. Offline and sync

- **[P1] As an owner, I want the restaurant to run fully without internet, so that an outage never stops service.**
  - Ordering, KDS, printing, billing and payments (cash) work on the local network alone
  - Events sync to the cloud when internet returns, with no duplicates and no lost orders
- **[P1] As a waiter, I want my tablet to keep working if the hub restarts, so that I don't lose an order mid-rush.**
  - Device queues its events locally and replays them when the hub is back
- **[P4] As an owner, I want another device to take over if the hub dies completely**, so that there is no single point of failure.

### E6. Roles, permissions and rules engine

- **[P1] As an owner, I want to create any number of custom roles, so that permissions match my actual staff.**
  - Each action (void, discount, refund, move item to return, reopen bill, edit menu, see reports) can be allowed, denied or set to "needs approval" per role
- **[P3] As an owner, I want to write rules as When / If / Then, so that my process runs without me watching.**
  - When = any event (void requested, discount applied, order placed, item ready, order late)
  - If = conditions (amount, role, table, time of day, item, station)
  - Then = actions (allow, require approval from role X, notify, print, WhatsApp the owner, assign a runner)
  - Multi-step approvals: e.g. a return goes to the manager, then to the owner above a limit
- **[P3] As a manager, I want a pending queue for approvals**, with a reason required on every approve or reject.
- **[P1] As an owner, I want every sensitive action logged with who, when and why**, and that log can never be edited.

### E7. Floor operations and staff

- **[P3] As a manager, I want to assign staff to zones and floors, so that the system knows who covers where.**
- **[P3] As a manager, I want a live heatmap of workload by zone, so that I can move helpers to where traffic is.**
  - Built from pending tasks and table activity, no GPS or beacons needed
  - Warns when a zone will have no one left if a runner leaves it (the "blackout" warning)
- **[P3] As a runner, I want to be told the next pickup and where to take it, so that food doesn't sit at the pass.**
  - Ready items are assigned to the nearest free runner, considering floors and zones
- **[P4] As a manager, I want shift scheduling and attendance**, so that I can see who is on and plan for rush days.

### E8. Billing and payments

- **[P1] As a cashier, I want to split bills by item, by person or by amount, and take mixed payments**, e.g. part cash, part card, part wallet.
- **[P1] As a cashier, I want to close my shift with a blind cash count, so that drawer shortages are caught honestly.**
  - Cashier enters the counted amount before seeing the expected total
- **[P2] As an owner, I want khata (credit) accounts for regulars and nearby businesses**, with balances, limits and reminders.
- **[P1] As an owner, I want invoices reported to the tax authority automatically**, with the integration pluggable per country or province (e.g. PRA in Punjab).
- **[P2] As a cashier, I want local payment methods built in**, such as QR wallets and bank transfer, plus cards, with reconciliation at shift close.

### E9. Customer-facing

- **[P2] As a parking or table customer, I want to scan a QR or get a WhatsApp link, so that I can track my order and its ETA live.**
- **[P2] As a customer, I want to add items from my phone**, with a confirmation step, and see the new ETA before I confirm.
- **[P2] As a customer, I want to message the waiter who took my order**, or call the waiter / ask for the bill from my table.
- **[P3] As a customer, I want to rate my order per item**, so feedback reaches the right station and dish.
- **[P3] As an order taker, I want returning customers recognised by phone number**, showing past orders and preferences like "less spicy".

### E10. Stock, prep and wastage

- **[P1] As a manager, I want a live countdown of pre-cooked stock**, e.g. "4 paye left", that also hides or slows the item on web and QR ordering when it runs out.
- **[P3] As a manager, I want to log end-of-day wastage per item**, so that cooked-but-unsold food is visible.
- **[P3] As a manager, I want a prep forecast for tomorrow, so that I pre-cook the right amount.**
  - Based on day of week, recent trend, holidays and special events
- **[P2] As an owner, I want ingredient-level inventory linked to recipes (full set in E0)**, with low-stock alerts and purchase records.

### E11. Owner dashboard and analytics

- **[P2] As an owner, I want a WhatsApp or email summary at closing**: sales, voids, discounts, late orders, wastage, top items.
- **[P2] As an owner, I want promised vs actual time for every order**, so service quality becomes a number I can track.
- **[P3] As an owner, I want to replay any rush on a timeline, so that I can see where queues built up and which station choked.**
- **[P3] As an owner, I want menu engineering**: each item placed by popularity and profit, so I know what to push, fix or remove.
- **[P3] As an owner, I want leakage alerts**: unusual voids, discounts or refunds by a person or shift.
- **[P2] As an owner, I want table turn time, peak hours and staff performance**, all viewable remotely.

### E12. Online, web and multi-branch

- **[P4] As an owner, I want a generated website with my menu and online ordering**, fed by the same menu and the same kitchen queue.
- **[P4] As an owner, I want delivery aggregator orders to land in the same queue**, manually at first, by integration later.
- **[P4] As an owner, I want multiple branches under one account**, with a central menu, branch-level overrides and a combined dashboard.
- **[P4] As a customer, I want to pre-order for a set time**, and the kitchen schedules backwards to hit it.

### E13. Special modes

- **[P3] As an owner, I want an iftar / peak-moment mode**, where pre-orders are scheduled to land at one exact time and the kitchen plan is worked backwards from it.
- **[P2] As a new staff member, I want a training mode**, where I practise orders without touching real data or printing real tickets.
- **[P1] As any staff member, I want the interface in my language with large icons**, e.g. Urdu and English for the pilot, any language later.

## Phased roadmap

Four phases, each unlocked by a gate that is passed at the pilot restaurant, not on a whiteboard.

| Phase | Focus | Contents | Gate to move on |
| --- | --- | --- | --- |
| P1 | Foundation and time engine, live at Arif Chatkhara | Menu, ordering, station KDS, printing, billing, per-item ETA, hold-and-fire, stock countdown, offline hub, PIN logins, custom roles, audit log, tax reporting, Z report, slip warnings | A full month of rushes with no lost orders, and staff trust the ETA they tell customers |
| P2 | Inventory, customers and the owner's view | Ingredient inventory, recipes, suppliers and purchases, learned cook times, delivery, QR and WhatsApp tracking, add items from phone, khata, daily owner summary, training mode | The owner trusts stock variance and the daily summary without double-checking |
| P3 | Operations intelligence | Rules engine and approval queues, zones, heatmap, runner dispatch, loyalty and vouchers, rush replay, menu engineering, leakage alerts, wastage and prep forecast, iftar mode | 10-15 owner conversations done, first paying restaurants outside the pilot |
| P4 | Scale and sell | Website and online orders, aggregator orders in the same queue, scheduled pre-orders, multi-branch, stock transfers, hub failover, shift scheduling, subscription billing | — |

The time engine ships in P1 with cook times set by hand; the start and done taps it logs from day one let P2 replace those numbers with measured averages. The P3 gate is a sales gate on purpose: owners outside the family must want it before the heavier features get built.

## Global readiness and open questions

Built in Lahore, designed so that moving to a new country is configuration plus one or two plug-ins, never a rewrite.

- **Language:** every label translatable, right-to-left layouts supported (Arabic, Urdu).
- **Currency and tax:** currency, tax rules and rounding per branch; tax-authority reporting as a plug-in per country or province.
- **Payments:** payment methods as plug-ins (local wallets, cards, bank QR), cash always available offline.
- **Messaging:** WhatsApp where it dominates, SMS or email where it doesn't.
- **Time and dates:** time zone per branch; special modes (iftar, holidays) driven by a calendar per region.
- **Data rules:** customer data stored per region where law requires it.

Open questions to settle before or during the pilot:

- [ ] Hub hardware: mini PC, old laptop or Android box? Needs to survive heat and power cuts
- [ ] Which tablets and printers does the pilot buy, and at what budget?
- [ ] How strict is the current tax-authority POS requirement for the pilot restaurant?
- [ ] Will kitchen staff tap start and done reliably? Test with the tandoor first
- [ ] Pricing: monthly vs yearly, per branch or per device? Decide after talking to 10-15 owners
- [ ] Which 3 features do other owners say they would pay for? Ask before building P3

## Market entry: UAE, UK, Canada, USA

Enter in this order: UAE, then UK, then Canada, then USA. Each market gets a country pack (tax, compliance, receipts, payments) on the same core, never a fork.

| Order | Market | Why now | Must-have compliance | First niche | Main local players |
| --- | --- | --- | --- | --- | --- |
| 1 | UAE | E-invoicing pilot began July 2026; mandate covers all businesses in phases, with monthly penalties for missing deadlines | E-invoicing via an Accredited Service Provider; VAT receipts; Arabic and English | Pakistani and South Asian-owned restaurants, catering | To research |
| 2 | UK | Independents are about 80% of the market and under cost pressure | MTD VAT, tips allocation law (2023), allergen labelling (Natasha's Law) | Curry houses and South Asian restaurants, delivery-heavy kitchens | Epos Now, Lightspeed, Square, Toast |
| 3 | Canada | Net closures expected in 2026, so savings sell; family branch possible | GST/HST/PST; French UI for Quebec | South Asian communities around Toronto and Vancouver | Square, Toast, Lightspeed, TouchBistro, Squirrel (chains) |
| 4 | USA | Biggest market; most tabs paid by card | State sales tax; certified payments partner; tips | High-volume and cloud kitchens; halal and South Asian restaurants | Clover, Toast, Square, Global Payments |

### Country pack user stories

- **[P4] As a UAE owner, I want invoices issued and transmitted through an accredited e-invoicing provider**, so that I avoid penalties without extra software.
  - Check which phase covers walk-in restaurant receipts vs B2B catering invoices before building
- **[P4] As a UK owner, I want VAT reporting ready for MTD, a tips allocation record per shift, and allergen info on every item and receipt.**
  - All 14 UK-regulated allergens selectable per item and shown at ordering
- **[P4] As a Canadian owner, I want GST, HST and PST handled per province**, and the whole UI available in French.
- **[P4] As a US owner, I want sales tax by state and city, and card payments through a certified partner**, with tips and tip pooling on the bill.
- **[P4] As any owner abroad, I want pricing, currency and receipts in my local format**, and support in my time zone.

### How to sell without living there

1. **Diaspora network first.** Owners abroad trust referrals; the 3 Arif Chatkhara branches are the proof.
2. **One local partner per country** who installs hardware and handles evening support, paid by revenue share.
3. **Lead with savings:** voids, waste and labour, then the ETA engine as the premium reason to pay.
4. **Free tier is normal abroad** (free POS plans are common in Canada and the US), so the engine and analytics must sit in the paid plan.
5. **Price in local currency.** One UK or UAE subscription can be worth several Lahore ones.

Sources: [UAE e-invoicing guide (VATit)](https://vatit.com/e-invoicing-guide/united-arab-emirates/) · [UK restaurant POS compliance](https://www.kaeltripton.com/restaurant-pos-system-uk/) · [UK restaurant outlook (Christie & Co)](https://www.christie.com/news-resources/business-outlook-2026/restaurants/) · [Canada POS guide (Expert Market)](https://www.expertmarket.com/ca/pos/best-pos-systems-canada) · [Canada restaurant closures (Toast)](https://pos.toasttab.com/ca/blog/on-the-line/how-to-know-when-youve-outgrown-your-restaurant-pos-system) · [US small-restaurant POS share (Payments Dive)](https://www.paymentsdive.com/news/toast-clover-battle-for-small-eateries/809108/)
