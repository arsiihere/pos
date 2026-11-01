# Competitor dossier — Blink (Blink Co Technologies)

**Date:** 2026-11-01 · **Sources:** Blink ki website (~40 pages), help center, release notes (2022–Oct 2026), API docs, aur bahar ki sources (news, funding databases, app stores, review sites).
**Rule:** har fact ke saath link. Zyada tar numbers Blink ke apne (self-reported) hain. Jahan sources aapas mein takraate hain, dono likhe hain. "Not found" = dhoondha, nahi mila.

> **Ek line mein:** Blink asal mein ek **online ordering + delivery company** hai (2018 mein Eat Mubarak aggregator se shuru hui) jis ne 2024 mein POS jor diya aur ab **payments** ki taraf ja rahi hai. Bari QSR chains ke references unki taqat hain. POS unka naya aur patla hissa hai — dine-in floor, kitchen aur offline mein kamzor.

---

## 1. Company snapshot

| Cheez | Detail | Source |
|---|---|---|
| Legal entity | Singapore Pte Ltd (ACRA). Website terms: "Mubarak Technologies Pte. Ltd." with subsidiaries Techworks and Blinkco Technologies. Play Store developer: "BLINK CO TECHNOLOGIES PTE. LTD." iPad app seller: "TECH WORKS (PRIVATE) LIMITED" (Pakistan operating co.) | [Terms](https://www.blinkco.io/terms-and-conditions/), [FAQ](https://www.blinkco.io/help-center/faq-what-is-blink/), [Play](https://play.google.com/store/apps/details?id=com.techworks.pos&hl=en), [App Store](https://apps.apple.com/us/app/blink-pos/id6445891133) |
| Founders | Syed Sair Ali (CEO, Riyadh-based), Syed Hyder Abbas (CTO). Eat Mubarak era mein Yusuf Jan (DotZero Ventures) bhi | [Wamda](https://www.wamda.com/en/2023/12/blink-closes-2-1-million-seed-round-enhance-presence-saudi-arabia), [ProPakistani 2019](https://propakistani.pk/2019/01/31/eat-mubarak-launches-food-delivery-service-in-faisalabad/) |
| Leadership | Hassan Mahmood (CRO), Ahmed Bilal (AGM), Nayha Arif (Marketing), Usama Iftikhar (Sr. Software Architect), M. Abdullah Tanveer (People); Sheikh Aqeel Ahsan (Country Head Pakistan, Sales) | [About](https://www.blinkco.io/about-us/), [TheOrg](https://theorg.com/org/blink-co-technologies) |
| Offices | Karachi (Block 6 PECHS), Lahore (DHA Phase 5, Sector G), Riyadh (Alyasmin). Islamabad office: nahi | [About](https://www.blinkco.io/about-us/) |
| Team size | Estimates 25–200 (65 BounceWatch, 51–200 TheOrg) | [BounceWatch](https://bouncewatch.com/company/blink-co-technologies), [TheOrg](https://theorg.com/org/blink-co-technologies) |
| Funding | ~$2.25 M total. Dec 2023 seed **$2.1 M** (500 Global, Global Founders Capital, SOSV/Orbit). SOSV/MOX accelerator 2019–22, Sanabil 500 MENA 2023. Dec 2023 ke baad koi round: not found | [Wamda](https://www.wamda.com/en/2023/12/blink-closes-2-1-million-seed-round-enhance-presence-saudi-arabia), [BounceWatch](https://bouncewatch.com/company/blink-co-technologies) |
| Revenue | ARR > $0.5 M (Dec 2023) | [Wamda](https://www.wamda.com/en/2023/12/blink-closes-2-1-million-seed-round-enhance-presence-saudi-arabia) |
| Scale claims | 1 200+ restaurants (Dec 2023) → 1 500+ (Oct 2025) → **2 000+ in Pakistan** (Oct 2026). Platform pe digital transactions > **PKR 2.5 B / month** | [Wamda](https://www.wamda.com/en/2023/12/blink-closes-2-1-million-seed-round-enhance-presence-saudi-arabia), [Business Recorder](https://www.brecorder.com/news/amp/40385298), [Nukta](https://nukta.com/blink-launches-payments-platform-for-2000-restaurants-in-pakistan) |
| Hosting | FAQ: AWS. Google Cloud case study: GCP pe migrate (Tridorian), 99.9% uptime claim, peak 7–9 pm | [FAQ Tech](https://www.blinkco.io/help-center/faq-technology/), [Google Cloud](https://cloud.google.com/customers/blink) |
| Tech hints | Flutter apps; API Laravel-style lagti hai (inference); PowerBI reports; WordPress/Elementor site; QZ Tray printing | [F&B](https://www.blinkco.io/blink-for-restaurants/), [Docs](https://docs.blinkco.io/), [POS 1.0.4](https://www.blinkco.io/?p=21882) |

**Inconsistencies:** founding year 2018 vs 2020; customer counts 200+ / 1 200 / 2 000+ / "3 000+ brands"; seed $2.1 M vs Forbes URL "$21m"; "24/7 support" vs FAQ 9 AM–1 AM; governing law Singapore aur California dono ([Terms](https://www.blinkco.io/terms-and-conditions/), [FAQ Support](https://www.blinkco.io/help-center/faq-blink-support/)).

## 2. Timeline

| Kab | Kya | Source |
|---|---|---|
| Sep 2018 | **Eat Mubarak** food delivery aggregator — Karachi, Lahore, Islamabad, ~1 400 outlets | [Dawn](https://www.dawn.com/news/amp/1454403) |
| Dec 2018 | 150k+ downloads, ~1 500 orders/day; competitors Cheetay, Foodpanda | [Aurora](https://aurora.dawn.com/news/1143277) |
| Feb 2020 | MOX cohort 8 (SOSV) | [KrASIA](https://kr-asia.com/meet-the-ten-startups-in-moxs-eighth-cohort) |
| Mid-2020 | Aggregator band; pivot to **direct online ordering** (Blink) — commissions merchants ke liye bahut mehngi thin | [Profit](https://profit.pakistantoday.com.pk/?p=158873) |
| 2022 | Fleet & driver management; POS 1.0.1 (Oct 2022) | [About](https://www.blinkco.io/about-us/), [POS 1.0.1](https://www.blinkco.io/?p=21839) |
| 2023 | Saudi launch; Dec: $2.1 M seed | [Wamda](https://www.wamda.com/en/2023/12/blink-closes-2-1-million-seed-round-enhance-presence-saudi-arabia) |
| 2024 | BlinkPOS "full-stack RMS" ke taur pe launch | [About](https://www.blinkco.io/about-us/) |
| Feb 2025 | Foodpanda orders → POS; Order Reversal module | [POS 1.1.9](https://www.blinkco.io/?p=26515) |
| Oct 2025 | Neem partnership (payment links, wallet, Raast) | [Business Recorder](https://www.brecorder.com/news/amp/40385298) |
| Jun–Oct 2026 | POS 1.2.2–1.2.8 burst: warehouse, GRN, food cost, KDS dashboard, cash denominations, split bill | [POS releases](https://blinkco.io/release-category/point-of-sales) |
| 13 Oct 2026 | **Blink Pay**: hard POS, soft POS, payment gateway, Raast, settlement reconciliation. Banks named: not found | [Nukta](https://nukta.com/blink-launches-payments-platform-for-2000-restaurants-in-pakistan) |
| 26 Oct 2026 | Lahore/Islamabad city SEO pages update; 5 Urdu + English blog posts (POS price, Foodpanda integration, RMS vs POS) | [Lahore](https://www.blinkco.io/best-restaurant-pos-lahore/), [Blog p2](https://www.blinkco.io/blog/2/) |

## 3. Products

Paanch lines: **POS & RMS**, **Online Ordering** (F&B, supermarket, retail), **Fleet & Driver**, **Loyalty & Engagement**, **Data & Analytics**; plus kiosk ([Home](https://www.blinkco.io/), [About](https://www.blinkco.io/about-us/)).

### 3.1 Pricing (USD, per branch / month)

| Product | Tier | Price | Kya hai |
|---|---|---|---|
| BlinkPOS | Starter | **$25** | Cloud POS, order/menu/inventory, revenue reconciliation, reports, shift schedule, offline mode, "24/7 support" |
| | Integrated | **$35** | + tax integrations (Lahore page: PRA/FBR, setup onboarding mein) + Foodpanda |
| | Pro | **$75** | + food costing, warehouse |
| Online ordering F&B | Web / Web+App | $50 / $100 | Loyalty, discount engine, geo-fencing, BI, account manager |
| Grocery | Web / Web+App | $150 / $300 | 100k SKUs |
| Fleet | Standard | $0.05 / ride | Rider assignment, routes, tracking |
| Own-channel orders | — | **~1% per order** | "nominal transactional fee" |

Sources: [Pricing](https://www.blinkco.io/pricing/), [Lahore](https://www.blinkco.io/best-restaurant-pos-lahore/), [Karachi](https://www.blinkco.io/best-restaurant-pos-karachi/), [FAQ Commercials](https://www.blinkco.io/help-center/faq-commercials/). PKR prices, setup fee, free trial: not found. App Store / Play developer accounts aur Google Maps API key ka kharcha customer ka ([Terms](https://www.blinkco.io/terms-and-conditions/)).

### 3.2 POS — asal mein kya hai (release notes se reconstruct)

| Area | Kya hai | Kab / source |
|---|---|---|
| **Dine-in** | New order → items → **table number + waiter** select → Open order → print. Dine-In toggle (off ho sakta hai). On-hold orders. Pre-payment bill. **Guest count** (Sep 2026). **Split bill** multiple payments (Oct 2026). **Table map, table transfer, merge: kahin nahi** | [POS 1.0.7](https://www.blinkco.io/release-notes/blink-pos-1-0-7-june-july-2023/), [1.0.4](https://www.blinkco.io/?p=21882), [1.2.6](https://www.blinkco.io/release-notes/blink-pos-1-2-6-september-2026/), [1.2.8](https://www.blinkco.io/release-notes/blink-pos-1-2-8-october-2026/) |
| **Kitchen** | KOT bina prices ke; category/station-wise KOT printers (Settings → Branch Devices); per-user printer by MAC; QZ Tray multi-printer; **Master KOT** (poora order ek ticket pe, assembler ke liye) | [1.0.3](https://blinkco.io/?p=21842), [1.1.6](https://www.blinkco.io/release-notes/blink-pos-1-1-6-april-may-2024/), [1.2.0](https://www.blinkco.io/release-notes/blink-pos-1-2-0-march-2025/) |
| **KDS** | Late aaya: **KDS sirf online orders ke liye** (Nov 2025), **KDS dashboard** (Sep 2026). Workflow ka koi public doc nahi | [1.3.6](https://www.blinkco.io/release-notes/blink-1-3-6-november-2025/), [POS 1.2.7](https://www.blinkco.io/release-notes/blink-pos-1-2-7-september-2026/) |
| **Voids / reversals / waste** | **Order Reversal**: request → merchant approve/reject, permissions configurable, corrections tracked. Open orders se waste, ab **reason zaroori**. "Return Item" permission. **Counter pe live manager-PIN void approval: kahin describe nahi** | [1.1.9](https://www.blinkco.io/?p=26515), [1.2.0](https://www.blinkco.io/release-notes/blink-pos-1-2-0-march-2025/), [1.2.1](https://www.blinkco.io/?p=26728), [1.2.7](https://www.blinkco.io/release-notes/blink-pos-1-2-7-september-2026/), [1.2.8](https://www.blinkco.io/release-notes/blink-pos-1-2-8-october-2026/) |
| **Roles / permissions** | Users & Roles: module checkboxes; order types per role; Open/On-hold aur manual discount restrictions; voucher sirf "In Kitchen" tak; Users & Roles revamp (Aug 2026). Users delete nahi, sirf deactivate | [1.2.0](https://www.blinkco.io/release-notes/blink-pos-1-2-0-march-2025/), [1.2.1](https://www.blinkco.io/?p=26728), [1.2.5](https://www.blinkco.io/release-notes/blink-pos-1-2-5-august-2026/), [FAQ Portal](https://www.blinkco.io/help-center/faq-portal-management/) |
| **Audit** | General audit log: not mentioned. Sirf reversal ke saath "corrections tracked" aur "Dish Toggle Logs" report | [Blog: 10 reasons](https://www.blinkco.io/blog/10-reasons-why-blink-pos-is-the-best-pos-system-for-cafes-in-pakistan/), [FAQ Portal](https://www.blinkco.io/help-center/faq-portal-management/) |
| **Shifts / cash** | Start shift → End shift → Shift report; pending orders ke saath shift band nahi hota (2025 se); opening cash; change calculation; **cash denomination count at close sirf Oct 2026 mein** | [1.0.1](https://www.blinkco.io/?p=21839), [1.2.1](https://www.blinkco.io/?p=26728), [1.2.8](https://www.blinkco.io/release-notes/blink-pos-1-2-8-october-2026/) |
| **Inventory** | Suppliers, POs, ingredient ↔ item, sub-recipes, ingredient report (purchase/sold/waste/consumption), **daily opening/closing stock lazmi — warna order punching block**, GRN (partial, advance tax), warehouse, food cost dashboard, central store → branch transfer | [1.0.1](https://www.blinkco.io/?p=21839), [1.1.3](https://blinkco.io/?p=23714), [1.1.8](https://www.blinkco.io/release-notes/blink-pos-1-1-8-august-2024/), [1.2.7](https://www.blinkco.io/release-notes/blink-pos-1-2-7-september-2026/) |
| **Tax** | Tax by branch aur payment method (cash vs card), inclusive GST, product-level tax, **Tax Wise Report with authority invoice numbers (FBR, SRB, PRA, BRA, KPRA)**, KPRA update Sep 2026. Setup steps ka public doc: nahi | [1.0.5](https://www.blinkco.io/?p=22102), [1.1.3](https://blinkco.io/?p=23714), [1.2.7](https://www.blinkco.io/release-notes/blink-pos-1-2-7-september-2026/) |
| **Offline** | Marketing: "Never Go Offline". Release notes mein sirf 2023 ka "Offline Web Ordering" (tablet "coming soon"); baad mein kabhi zikr nahi. Unka apna blog maanta hai offline hamesha seamless nahi, backup hotspot rakho. Hardware requirement FAQ: computer + internet | [POS](https://www.blinkco.io/blink-pos/), [1.0.3](https://blinkco.io/?p=21842), [Blog: cloud](https://www.blinkco.io/blog/using-cloud-based-pos-systems-in-your-restaurant-pros-and-cons/), [FAQ What is Blink](https://www.blinkco.io/help-center/faq-what-is-blink/) |
| **Channels** | Counter, own web/app, call-in, QR, kiosk, **Foodpanda → POS**, Deliverect, custom 3P channel; Oct 2026 se online ordering POS ka channel | [1.0.8](https://blinkco.io/?p=23252), [1.1.7](https://blinkco.io/?p=24397), [1.2.8](https://www.blinkco.io/release-notes/blink-pos-1-2-8-october-2026/) |
| **Reports** | "17+ reports" incl. P&L, peak hours, waiter report, product mix, day-end email, PowerBI | [Blog: 10 reasons](https://www.blinkco.io/blog/10-reasons-why-blink-pos-is-the-best-pos-system-for-cafes-in-pakistan/), [1.2.1](https://www.blinkco.io/?p=26728) |
| **Hardware** | Hardware-agnostic: Android tablets, Windows laptops; Flutter POS app; iPad app. Printer list / hardware prices: not found | [Blog: 10 reasons](https://www.blinkco.io/blog/10-reasons-why-blink-pos-is-the-best-pos-system-for-cafes-in-pakistan/), [1.0.8](https://blinkco.io/?p=23252) |
| **Language** | English + Arabic (RTL). Urdu UI: not found (Urdu sirf marketing blogs mein) | [1.0.6](https://www.blinkco.io/?p=22296), [F&B](https://www.blinkco.io/blink-for-restaurants/) |
| **Integrations** | MS Dynamics, ERPNext APIs, Shopify; payments: Checkout, Stripe, Pay2M, CCAvenue, Alfalah, Easypaisa, JazzCash, Raast (Swich); delivery: Bykea, pandago | [1.2.1](https://www.blinkco.io/release-notes/blink-1-2-1-december-2023/), [1.1.8](https://www.blinkco.io/release-notes/blink-pos-1-1-8-august-2024/), [1.2.9](https://www.blinkco.io/release-notes/blink-1-2-9-december-2024/), [FAQ Logistics](https://www.blinkco.io/help-center/faq-logistics/) |

**POS adoption:** Blink POS Android app **1K+ installs**, ~12–17 reviews; iPad app ke ratings itne kam ke dikhte nahi ([Play](https://play.google.com/store/apps/details?id=com.techworks.pos&hl=en), [App Store](https://apps.apple.com/us/app/blink-pos/id6445891133)). Yani 2 000 restaurants mein se zyada tar unki **online ordering** use karte hain, POS nahi (inference — exact POS customer count: not found).

### 3.3 Online ordering (unka core)

- Branded website + Flutter apps, orders seedha BlinkPOS mein; pitch: aggregator fees nahi, customer data aapka ([F&B](https://www.blinkco.io/blink-for-restaurants/)).
- Merchant portal: Live Orders (accept/reject, ETA, edit), auto-accept, pre-orders, Excel export, promo codes (bahut detailed), bulk section discounts, loyalty % of order, wallet refunds, SMS campaigns, WhatsApp deep link, Facebook audience export ([FAQ Orders](https://www.blinkco.io/help-center/faq-order-management/), [FAQ Promotion](https://www.blinkco.io/help-center/faq-promotion-engagement-loyalty/), [FAQ Customers](https://www.blinkco.io/help-center/faq-customer-data-management/)).
- Analytics: sales by city/branch/category, retention/LTV/churn, funnel, complementary items, rejection, time-to-deliver ([Analytics](https://www.blinkco.io/advanced-data-and-analytics/)).
- Onboarding: contract → requirements → theme → go-live ~7 business days ([FAQ Getting Started](https://www.blinkco.io/help-center/faq-getting-started/)).
- Academy aur Help center **sirf online ordering portal aur marketing** ke baare mein hain; POS training material: nahi ([Academy](https://www.blinkco.io/blink-academy/), [Help center](https://www.blinkco.io/help-center/)).

### 3.4 Delivery / fleet / loyalty

- Rider app (auto/manual assign, routes, rejection reasons), rider portal, 3PL (Bykea, pandago), rider cash collection (Oct 2026) ([Delivery](https://www.blinkco.io/blink-for-delivery/), [1.3.10](https://www.blinkco.io/release-notes/blink-1-3-10-october-2026/)).
- Loyalty: points, promo codes, e-wallet, push/SMS/email, triggers (signup, birthday, abandoned cart), referrals, wallet expiry ([Loyalty](https://www.blinkco.io/loyalty-and-engagement/), [1.3.7](https://www.blinkco.io/release-notes/blink-1-3-7-jan-mar-2026/)).

## 4. API (docs.blinkco.io)

Credentials Blink support se request karne parte hain (username/password → Bearer token). Sandbox `stg-api.blinkco.io`, prod `api.blinkco.io` ([Docs](https://docs.blinkco.io/)).

| Area | Endpoint | Note |
|---|---|---|
| Menu import | `POST /interface/v1/importMenu` | products, category, per-branch price/stock/active, modifiers (max options, priority) |
| Fetch menu / categories | `GET /fetchMenu`, `/categories` | Paginated, day flags, modifier min/max |
| Stock & price | `POST /syncStockAndPrice` | **Max 50 products / call, modifiers nahi** |
| Webhooks | `POST /webhooks` | type 1 order created, 2 status update; custom header; **5 s timeout, retry nahi, signing nahi** |
| Branches / geofence / customers | `GET` | tax %, inclusive flag, delivery polygons, wallet & points |
| Orders | `cartCalculator`, `submitOrder`, `getOrder`, `getOrderList`, `getAbandonedCarts` | `source` (FOODPANDA, GRUBTECH, CONVIYO), `fbr_pos_charge`, `pos_fee`, `kitchen_notes`, types DINE-IN / PICK-UP / DELIVERY, channels 7–12 |
| Status sync | `POST /syncOrderStatus` | 0 Pending, 1 Accepted, 6 Ready, 2 Dispatched, 3 Delivered, 4 Rejected (comment lazmi); 5 undefined |
| Logistics | `/api/client/task` | events 20–29 (created → finished/cancelled) |

Docs ki kamiyan: rate limits, idempotency, error catalogue, webhook retries — documented nahi; kuch fields inconsistent.

**Third-party POS kya kar sakta hai:** menu push (`importMenu` + `syncStockAndPrice`), type-1 webhook se Blink web/app/Foodpanda orders lena (5 s mein ack, phir queue), kitchen status wapis (`syncOrderStatus`). Matlab **tumhara POS Blink ki online ordering ke saath chal sakta hai** — agar Blink credentials de.

## 5. Customers

| Market | Brands | Source |
|---|---|---|
| Pakistan (Oct 2026, Blink Pay coverage) | Hardee's, Dunkin', Baskin Robbins, OPTP, Sweet Creme, Brim, Savour Foods, Crumble, Crusteez, Red Apple, Artisan, Remix, Dot, Froth | [Nukta](https://nukta.com/blink-launches-payments-platform-for-2000-restaurants-in-pakistan) |
| Pakistan case studies | Cheezious, Burger Lab, Char-Grilled Central, Lettus Kitchens, 2030 Kitchen, Nando's, SPAR, Il Forno | [Customers](https://www.blinkco.io/customers/), [Pakistan archive](https://www.blinkco.io/blog/country/pakistan/) |
| POS page | Chaudhry Chaplin, Froth, Jazeera Food, Rowtisserie, The Sweet Rack, Flame On PK, Eatology | [POS](https://www.blinkco.io/blink-pos/) |
| Lahore page | Crumble, Second Cup | [Lahore](https://www.blinkco.io/best-restaurant-pos-lahore/) |
| Gulf | IHOP (Kuwait, Qatar, Bahrain), Applebee's, Tanmiah, Pizza Online KSA | [Profit](https://profit.pakistantoday.com.pk/?p=158873), [Play dev](https://play.google.com/store/apps/dev?id=6244705314132726962&hl=en) |

Pattern: **QSR, cafés, bakeries, desserts, chains — delivery/takeaway heavy.** Desi dine-in (paye, nihari, karahi, BBQ) brand: list mein nahi mila.

## 6. Reviews

- G2: 4.3 from 9 reviews ([G2](https://www.g2.com/sellers/blink-co)). Software Advice: 4.9 from 10, mostly 2021–22; cons: local BIN numbers support nahi, support delay, branch selection unclear ([Software Advice](https://www.softwareadvice.co.uk/software/268840/blink)).
- White-label app complaints (Savour): Easypaisa timeout, "invalid geofence" error, tax cart mein missing — platform bugs ho sakte hain ([App Store](https://apps.apple.com/us/app/id1636765236)).
- Capterra / Trustpilot / Reddit / Google reviews: not found.

## 7. Legal / commercial terms (customer ke liye)

- Fees **USD**, advance, 1 ya 12 mahine, auto-renew; 1-year contract, exit pe 30 din notice; 14-day refund, uske baad nahi; chargeback = permanent ban ([Terms](https://www.blinkco.io/terms-and-conditions/), [FAQ Legal](https://www.blinkco.io/help-center/faq-legal/)).
- Service **"AS-IS"**, uptime % nahi; termination pe data delete ho sakta hai; data ownership clause nahi; terms March 2022 ke ([Terms](https://www.blinkco.io/terms-and-conditions/)).
- Support: FAQ ke mutabiq 9 AM–1 AM PKT portal chat; bugs 1–7 din ([FAQ Support](https://www.blinkco.io/help-center/faq-blink-support/), [Terms](https://www.blinkco.io/terms-and-conditions/)).

## 8. Positioning aur marketing

- Core message: "aggregator chhoro, apna channel, apna data" ([F&B](https://www.blinkco.io/blink-for-restaurants/)).
- 2026: city SEO pages (MM Alam, Gulberg, DHA, Johar Town), **Urdu + English** blogs, Foodpanda integration posts, "free POS ke chhupe kharche" (seedha Oscar ki taraf ishara, naam nahi liya) ([Blog p2](https://www.blinkco.io/blog/2/), [Blog: free POS](https://www.blinkco.io/blog/should-your-restaurant-get-a-free-pos-system-pros-cons-and-smarter-alternatives/)).
- Apne comparison pages: GrubTech, Taker — evidence ke bina "far more advanced" ([vs GrubTech](https://www.blinkco.io/?p=11640)).
- Direction: **payments/fintech** (Neem → Blink Pay), POS back-office (warehouse, GRN, food cost), GCC + Bangladesh SEO.

---

## 9. Blink vs tumhara POS — seedha comparison

| Area | Blink (aaj) | Tumhara POS — built | Tumhara POS — planned | Kaun aage |
|---|---|---|---|---|
| Order taking (counter, dine-in) | ✅ 2023 se | ❌ | 02 | **Blink** |
| Table + waiter | ✅ number + waiter; map/transfer/merge nahi | ❌ | 02 tiles per floor + handover with acceptance | Blink aaj; design mein tum |
| KDS | ✅ dashboard Sep 2026 (naya) | ❌ | 03b + timing engine | Blink aaj |
| Kitchen timing / hold-and-fire | ❌ not found | ❌ | 03a | **Kisi ke paas nahi** — tumhara mauqa |
| Master KOT / assembler | ✅ | ❌ | 03b | Blink |
| Void / approval | Reversal approval after-the-fact, waste reason, return permission | Approver roles (data only) | 04 + approve on own device | Design mein tum; aaj Blink |
| Audit log | Not mentioned | ✅ event store (immutable) | 04 view | **Tum** (foundation built) |
| Offline | Claim, detail nahi, blog khud weak maanta hai | ✅ LAN hub + SQLite (order flow ke bina) | 06 | **Tum** (architecture) |
| Shifts / cash close | ✅ denomination count Oct 2026 | ❌ | 05 blind count, Z report | Blink |
| Inventory / recipes | ✅ deep (sub-recipes, GRN, warehouse) | Pre-cooked stock only | Recipe module baad mein | **Blink** |
| Tax PRA/FBR | ✅ $35 tier, authority invoice numbers | ❌ | Milestone C | **Blink** |
| Foodpanda | ✅ | ❌ | Plan mein nahi | **Blink** |
| Online ordering / loyalty / fleet / payments | ✅ core | ❌ | Plan mein nahi | **Blink** |
| Menu variants / modifiers / deals | ✅ modifiers | ✅ variants, modifier groups, deals | — | Barabar |
| Roles / permissions | Module checkboxes + toggles | ✅ custom roles, scopes, approver lists | — | **Tum** |
| Urdu UI | ❌ | Urdu font + keys (review pending) | — | Tum (thoda) |
| Price | $25 / 35 / 75 per branch + ~1% own-channel | — | — | — |

## 10. Blink se kya seekhna / kya copy karna

1. **Pricing ka shape:** public, per-branch, teen tiers, tax integration beech wale tier mein. Tumhe bhi ek simple public price chahiye.
2. **Master KOT** (assembler ke liye poora order ek slip pe) — desi dine-in mein bhi kaam ka. 03b mein rakho.
3. **Shift close lock:** pending orders ke saath shift band na ho — 05 mein sasta aur kaam ka.
4. **Waste with reason** — 04 mein chhota feature, owner ko pasand aayega.
5. **City SEO + Urdu content** — Blink abhi (Oct 2026) Lahore ke liye ye kar raha hai. Ye sasta distribution hai; tum bhi kar sakte ho jab product live ho.
6. **Onboarding 7 din ka process** — tumhare liye bhi ek likha hua onboarding checklist (menu import, PRA POS ID, printers, training).

## 11. Kahan attack karna hai

1. **Desi dine-in floor:** Blink ke customers delivery/QSR hain; table map, transfer, live void approval, kitchen timing unke paas nahi. Pitch: "floor aur kitchen pe control".
2. **Chori/void control as the headline:** Blink ka approval after-the-fact hai (reversal request). Tumhara pitch: void counter pe **usi waqt** manager approve kare, aur owner ko phone pe dikhe. Ye 04 ke bina nahi bik sakta — isliye 04 ko aage lao.
3. **Asli offline:** Blink ka apna blog hotspot recommend karta hai. Tumhara hub "net gaya to bhi bill aur KOT chalta rahe" — lekin ye **demo karke dikhana hoga**, sirf kehna kaafi nahi.
4. **Support time:** Blink ka actual support 9 AM–1 AM chat hai, bugs 1–7 din. Tum Lahore mein ho — "on-site same day" pehle 10 customers ke liye bech sakte ho.
5. **Contract terms:** Blink USD, advance, 1-year auto-renew, AS-IS. Tum PKR, monthly, no lock-in de sakte ho.

**Jahan mat lado:** online ordering, loyalty, fleet, payments, bari QSR chains. Wahan unke 8 saal aur references hain.

## 12. Integration: dushman se channel

Blink ka API third-party ko orders aur menu deta hai (section 4). Flow: tumhara cloud webhook receive kare (5 s ack) → hub ko bheje → tumhara KDS → `syncOrderStatus` wapis. Ye **06 (sync) ke baad** hi possible hai; pilot mein nahi. Pitch: "online ordering Blink ki rakho, dine-in aur kitchen hamara."

## 13. Blink demo call pe poochne wale sawal (sales intel)

1. KDS dine-in orders ke liye bhi chalta hai ya sirf online? Kitchen timing / late alert hai?
2. Void ya discount pe counter pe manager approval kaise hoti hai? Owner ko alert milta hai?
3. Net jaaye to POS kitni der chalta hai? Kya Android tablet pe offline hai? Wapis aane pe kya hota hai?
4. PRA e-IMS kaun setup karta hai, kitne din, extra fee? Offline mein PRA number kaise print hota hai?
5. Table transfer / merge / floor map hai?
6. Third-party POS ko API credentials milte hain? Fee? "POS partners" kaun hain?
7. PKR mein price, setup fee, hardware, contract lock-in?
8. Lahore mein dine-in desi restaurant customers ke naam (reference call)?

Har jawab directly tumhari positioning confirm ya galat karega.

---

### Corrections to `market-and-product-assessment.md`

Pehli report mein Blink ke baare mein ye galat ya adhoora tha (website pages se); release notes ke baad sahi:
- Blink ke paas **table number + waiter selection 2023 se** hai (map/transfer/merge nahi).
- **KDS dashboard Sep 2026** mein aaya; online orders ke liye KDS Nov 2025.
- Tax report mein **PRA/FBR/SRB/BRA/KPRA invoice numbers** — tax integration release notes se evidenced hai.
- Release notes Oct 2026 tak hain (v1.3.10, POS 1.2.8), sirf 2025 tak nahi.

### Not loaded / not covered
YouTube (Academy videos), LinkedIn headcount/jobs, ProPakistani Blink Pay article (Nukta copy use kiya), kuch POS release pages (1.1.0–1.1.2, 1.2.2–1.2.4), integrations page ke partner naam (logos bina naam ke).
