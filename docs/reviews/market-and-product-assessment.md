# Market and product assessment — restaurant POS (independent, skeptical)

**Date:** 2026-11-01 · **Reviewer:** Claude (independent review, read-only on code) · **Repo state:** `main` @ `fce932e`, `module-01d` @ `24af0f5`
**Language:** Hinglish (Roman Urdu + English), jaisa maanga gaya.

> TL;DR: Engineering discipline asli hai aur jo bana hai woh solid hai. Lekin **aaj ye POS ek bhi order nahi le sakta.** Bana hua hissa "restaurant setup + staff + menu + login" hai — yaani POS ka foundation, POS nahi. Pilot ke liye zaroori har cheez (order, KDS, print, bill, backup) **abhi spec bhi nahi hui.** Aur Punjab mein PRA e-IMS ab har registered restaurant pe sakhti se lag raha hai — jab tak PRA integration nahi, ye **Punjab mein bechne ke qabil nahi.** PRA ko "end" pe rakhna (R13) ab galat faisla hai.

---

## 0. Method aur evidence

- Repo GitHub `arsiihere/pos` se clone kiya (local `~/pos` is session se reachable nahi tha). `main` aur `module-01d` dono dekhe. Kuch edit nahi kiya; sirf ye file likhi.
- Padha: `docs/specs/README.md` (module map, R1–R32 main pe, R33–R34 `module-01d` pe), foundation v1.7 (main) / v1.8 (01d), module specs ki headings, `docs/stories/stories-refined.md`, `docs/plans/*-status.md`, `docs/reviews/`. Code: `apps/hub`, `apps/cloud`, `apps/client`, `packages/*`.
- Tests khud chalaye (`pnpm install --frozen-lockfile`, `pnpm test`, local Postgres 16 on :5433 — Docker available nahi tha).
- Market research web se; har claim ke saath link. Jo nahi mila, "not found" likha.

---

## Part 1 — Repo: BUILT vs PLANNED

### 1.1 Test results (khud chalaye)

| Run | Result | Note |
|---|---|---|
| `main` — cloud project (Postgres) | **94 files, 470/470 pass** | 279 s |
| `main` — hub, client, domain, events, engine | **883/884 pass** | Ek fail: `apps/hub/test/db/pre-migrate-backup.int.test.ts:116-127` — test `chmod 0555` pe depend karta hai; root user pe permission ignore hoti hai. **Environment artifact, product bug nahi.** Test ko `uid === 0` pe skip karna chahiye. |
| `main` total | 1 354 tests; asli failures **0** | Pehli full run mein mera Postgres band ho gaya tha (meri scratch dir ki permission), cloud re-run clean tha |
| `module-01d` — non-DB projects | **933/934 pass** (wahi root-only fail) | 01d status board ka apna gate: 1 404 tests green |

Typecheck/lint maine alag se nahi chalaya; status boards ke mutabiq gate (typecheck + lint + test) green hai.

### 1.2 Kya BANA hai (code + passing tests)

| Module | Status | Evidence |
|---|---|---|
| 00 Hub Platform & Access | Built | Event store, command registry, migrations, provisioning, device pairing (QR), PIN login, sessions, lockouts, hub admin page. Pending: hardware smoke #79 (5 ms p95 miss, ~7 ms) — `docs/specs/README.md:14` |
| 01a Restaurant Setup | Built (v2.0 via 01c) | Floors, tables, stations, batch programs, item routes, per-branch price, business day open/close, pre-cooked stock entry, config sync cloud→hub |
| 01b Staff & Roles | Built | Custom roles, permissions, approver lists, staff without PIN, reports-to, responsibilities, branch settings, owner password flows |
| 01c Menu variants | Built | Variant groups, stock items, modifier groups, deals |
| UI "Pulse" | Built | Owner app + hub stock page redesign, Urdu font bundled (Urdu text review pending) |
| 01d Notifications | **Spec v1.0 + plan (46 tasks); sirf batch 0–1 (tasks 0–5) built** | `module-01d` branch, `docs/plans/01d-status.md` |

Size: ~48 k lines source, ~51 k lines tests, ~43.5 k lines docs (130 markdown files). Saara kaam **2026-10-22 se 2026-10-31** ke darmiyan, ~800 commits (276 `docs`, 233 `feat`, 171 `fix`).

### 1.3 Kya SIRF PLANNED hai (spec ya story, code zero)

`docs/specs/README.md:19-25` khud kehta hai: **02 Ordering + Tables, 03a Timing Engine, 03b KDS + Printing, 04 Voids + Audit, 05 Billing, 06 Offline + Sync, 07 Owner View — sab "Not started".** Spec bhi nahi likhi.

Code mein confirm:
- Hub mein total **15 commands** hain, ek bhi order ka nahi (`apps/hub/src/commands/`: business day, stock, availability, pairing, sessions, PIN lockout). `SubmitOrder`, `ItemAdded` handler, `calculateETA` — kahin nahi.
- `packages/engine/src` sirf **203 lines** — sirf stock slice aur business day. Timing engine (jo product ka "differentiator" hai) **exist nahi karta.**
- Client ke sirf do entries: `owner` aur `admin-stock` (`apps/client/vite.config.ts:5-8`). Cashier, order-taker, KDS screen — nahi.
- Printing: ESC/POS ka koi code nahi. Backup: nightly USB backup ka koi code nahi (sirf pre-migration encrypted backup, 00 M21).
- PRA/FBR: milestone C mein, "deferred to the end" (`README.md:35`, `R13` at `README.md:104`).

### 1.4 (a) Restaurant AAJ is se kya kar sakta hai?

Imandari se: **operationally kuch nahi.** Owner cloud pe menu, stations, tables, staff, roles bana sakta hai; hub pe devices pair ho sakte hain, staff PIN se login kar sakta hai, business day khol/band ho sakta hai, pre-cooked stock enter ho sakta hai. Lekin order lena, kitchen ko bhejna, print karna, bill banana, payment lena, Z report — **kuch bhi nahi.** Ye ek achha admin/back-office skeleton hai.

### 1.5 (b) Pilot chalane se pehle kya missing hai

Milestone A ki apni list (`README.md:33`): 00, 01a, 01b, 01d, 01c, 03a, 02, 04, 03b, 05 + 06 ka nightly USB backup. Baqi:

| Pilot need | Status | Kitna bara |
|---|---|---|
| Take orders (02) + table handling | Spec nahi | Sab se bara module: order lines with variants/modifiers/deals (01c §4.3 contract), weighed lines, table lock, handover with acceptance (R23), command queue offline per device |
| Timing engine (03a) | Spec nahi; engine 203 lines | Hold-and-fire, stock reservation, ETA. Bina iske KDS sirf ticket list hai |
| KDS (03b) | Spec nahi | Station screens, start/done, batch stations |
| Printing (03b) | Spec nahi | ESC/POS, 58 + 80 mm, USB + LAN (R8), receipt template (R12). **Hardware pe test chahiye** |
| Voids + approvals + audit (04) | Spec nahi | 01c ne void refund rules already itne complex bana diye hain (`README.md:193`) |
| Billing (05) | Spec nahi | Payments, shifts, Z report, blind count, tax at bill close |
| Notifications (01d) | Spec ready, 41/46 tasks baqi | Tablet app in **lock-task device-owner mode** (R33) — hardware provisioning |
| Nightly USB backup (06 slice) | Spec nahi | Encrypted, key availability on restore open (MQ8) |
| Tablets / hub hardware | OQ1, OQ2 open | Hub PC decide nahi, tablet model decide nahi |
| Urdu | 447+ keys native review pending | Pilot staff ke liye zaroori ho sakta hai |

### 1.6 (c) Code aur architecture quality — evidence ke saath

**Achha (genuinely):**
- Durable write path sahi bana hai: ek `IMMEDIATE` transaction mein events append + projections + reducer, aur state swap commit ke **baad** (`apps/hub/src/engine-host/writer.ts:54-86`). SQLite `WAL` + `synchronous = FULL` (`apps/hub/src/db/connection.ts:6-9`) — power cut pe data loss se bachata hai. Pakistan ke liye bilkul sahi choice.
- Idempotency do baar check hoti hai, transaction ke bahar aur andar (`apps/hub/src/commands/route.ts:81-83, 95-97`) — retransmit race ka sahi ilaj.
- Auth generation check inside tx (`route.ts:98`) — revoked session race band.
- Tenant guard + cross-tenant sweep test har cloud route pe (C7, `apps/cloud/test/route-inventory.int.test.ts`). Multi-tenant SaaS ke liye solid base.
- Test discipline asli hai: spec-numbered tests, race tests, ~1:1 test-to-code ratio.
- Offline-first LAN hub architecture Pakistan ke internet aur bijli ke haalaat ke liye **sahi bet hai** (Part 2.3 dekhein).

**Kamzor (evidence):**
- Formatter nahi hai: `route.ts:101-119` ka indentation toota hua hai (`const ctx` block function scope se kam indent). Repo mein Prettier config nahi. Chhoti cheez, lekin AI-generated code mein drift ka sign.
- Har command pe redundant work: `route.ts:120-124` pehle `MAX(seq)` padhta hai aur `route.ts:127-131` dobara events table query karke `event_ids` nikalta hai, halankeh `tx.append()` already events return karta hai (`writer.ts:16, 62-71`). Aur `tx.db.prepare(...)` har request pe naya statement banata hai (`route.ts:121, 129, 136`). Ye hot path hai — 00 ka 5 ms p95 target dev box pe miss (~7 ms, `README.md:14`). Pehle yahin dekhein.
- Post-commit hooks commit ke baad throw kar sakte hain (`writer.ts:90-93`) → client ko error milega jabke command commit ho chuka. Idempotent replay isse bachata hai, lekin error path ka test hona chahiye.
- Do UI stacks: hub pe string-built HTML + inline JS pages (`apps/hub/src/admin/page.ts` 1 195 lines, `lib/page.ts`) aur alag React client. Solo dev ke liye do jagah UI maintain karna mehnga.
- Owner bundle 632 kB (170 kB gzip), Vite warning — budget phones pe slow ho sakta hai.
- Test env assumption: pre-migrate test root pe fail (upar).

**Verdict:** jo code bana hai woh T2 production quality ke qareeb hai. Masla code quality nahi, **kya banaya** aur **kis order mein** hai.

### 1.7 (d) Over-engineering vs pilot ki zaroorat

Seedhi baat: **process aur scope dono pilot ke size se bahut bare hain.**

| Evidence | Kyun masla hai |
|---|---|
| Docs ~43.5 k lines vs source ~48 k lines; 276 of ~800 commits sirf docs | Har line spec ki maintenance cost hai. Solo dev ke liye ye ratio unsustainable hai |
| 01c spec: v0.1 → v1.1, **10 versions ~3 din mein**, 1 566 lines — sirf menu variants ke liye; har version file repo mein rakhi | Menu variants ek din ka CRUD hona chahiye tha pilot ke liye |
| SQL statement-count bounds spec mein ("26 of ≤ 26", `README.md:196`) aur tests mein | 3 branches, ~10 devices pe ye optimisation-theatre hai. Har naya field spec bump maangta hai |
| 01d: 1 269-line spec, 46 tasks, alert state machine, escalation, **Android tablet app in device-owner lock-task mode** (R33) — **ek bhi order se pehle** | Notifications ka matlab hai "approval chahiye". Pilot mein manager ka PIN cashier screen pe kaafi hai (yeh fallback spec mein already hai) |
| Teams / reports-to (R24), workload & capacity stats (R25), main + secondary role, approver role lists | Ye P2/P3 features hain jo owner ki ek baat-cheet se aaye; data ka shape abhi fix karna premature hai |
| Hostile review → fix → re-review loop har module pe (01c G4 runs 1–5, 01d runs 1–3) | Quality laata hai, lekin ek module ka calendar 2–3 din kha jata hai jo ab 7 baqi modules mein nahi hai |
| Foundation "frozen" (D64), phir 9 din baad R34 se freeze hata diya | Process khud apne aap ko override kar raha hai — sign ke process rigid zyada hai |

Jo **justified** hai: event store + audit (anti-theft core), offline hub, tenant guard, money as integers, idempotent commands.

### 1.8 (e) Pilot date 2027-02-28 — kya ho sakta hai?

**Velocity ka sach:** 10 din mein 00 + 01a + 01b + 01c + UI ban gaye — AI autobuild pipeline (`tools/autobuild/`) se velocity waqai bahut tez hai. Agar yahi raftar rahe to remaining 7 modules raw build mein 4–6 hafte lagenge. Calendar mein ~17 hafte hain. To kagaz pe ho sakta hai.

**Lekin is velocity ko aage project karna galat hoga:**
1. Jo bana woh **CRUD/config** hai — deterministic, hardware-free. Jo baqi hai woh real-time, concurrency aur hardware hai: KDS timing, printer drivers, tablets in lock-task mode, rush-hour load. Ye AI se tez nahi hota; ye field mein tootta hai.
2. Har module ka spec + hostile review cycle 2–4 din. 7 modules = 3–4 hafte sirf specs.
3. Aap ki full-time job hai (CineMENA client project). Ye solo, part-time hai.
4. Field shadow-testing chahiye: rush ke din, asli staff, asli printer. Kam se kam 2–4 hafte.
5. **2027-02-28 Ramadan ke beech mein aata hai.** Ramadan 2027 Pakistan mein ~9 Feb se ~9 Mar expected hai ([Wego](https://blog.wego.com/ramadan-2027/)). Sehri/iftar rush pattern normal nahi hota, staff thaka hota hai — naya system install karne ka sab se bura waqt. Desi paye/nihari restaurant ke liye sehri ka waqt peak ho sakta hai.

**Estimate:**
- Jaise spec'd hai (01d full, 03a full, 04 full, R23 handover, etc.): **~20–30% chance** ke 28 Feb ko ek branch pe stable chale.
- Scope cut ke saath ("Pilot-Min", Part 3.5): **~65–75% chance** — aur pilot ko **Ramadan se pehle (late Jan)** ya **Eid ke baad (mid/late Mar)** rakhein. Meri recommendation: shadow mode late Jan, go-live Eid ke baad.

---

## Part 2 — Market research

> Note: Pakistan ke local POS vendors ke public reviews almost zero hain; zyada tar information vendor websites se hai (marketing). Jo verify nahi hua, wahi likha hai.

### 2.1 Pakistan mein bikne wale restaurant POS

| Vendor | Origin / segment | Pricing | Features (claims) | Maturity |
|---|---|---|---|---|
| **Blink** | Local (Karachi, Lahore, Riyadh); multi-branch QSR & chains — OPTP, Cheezious, Crumble testimonials ([pricing](https://blinkco.io/pricing/)) | USD per branch/month: Starter $25, Integrated $35, Pro $75 ([pricing](https://blinkco.io/pricing/)) | Offline mode, inventory, reconciliation, analytics sab tiers mein; "tax integrations" + Foodpanda Integrated tier mein; food costing Pro mein ([pricing](https://blinkco.io/pricing/)); Master KOT, 17+ reports ([Blink POS](https://www.blinkco.io/?p=27060)). KDS / waiter / owner app: not found | 3 000+ brands claim ([about](https://blinkco.io/about-us/)); Blink Pay launch Oct 2026 ([ProPakistani](https://propakistani.pk/2026/10/13/blink-launches-blink-pay-to-simplify-restaurant-payments-and-bank-settlements-in-pakistan/)) |
| **Oscar** | Local, launched 2017 ([award post](https://oscar.pk/blog/success-story-oscar-won-pasha-ict-awards-2017)); restaurants, cafés, cloud kitchens, chains | **Free POS + free card machine**, earns 1.2% + Rs 10 per card txn ([free POS](https://oscar.pk/solutions/free-pos)) | Offline sync, KDS, recipes, multi-branch dashboard, owner app, staff ordering app, "FBR, SRB, PRA ready", Foodpanda sync, loyalty ([restaurants](https://oscar.pk/solutions/restaurants-solution)) | Clients: Burger Lab, Cinnabon, Loco, Biryani Buzz, etc. ([restaurants](https://oscar.pk/solutions/restaurants-solution)); count not found |
| **CORN POS** | Lahore (Arfa Tower), fast food → fine dining → chains ([PRA blog](https://www.cornpos.com/blog/restaurant-pos-integration-with-pra)) | Starter $50, Pro $130 /branch/month, Elite contact ([pricing](https://www.cornpos.com/pricing)) | PRA e-invoicing + KDS ([PRA blog](https://www.cornpos.com/blog/restaurant-pos-integration-with-pra)); SRB ([SRB blog](https://www.cornpos.com/blog/pos-integration-with-srb)); offline, owner/staff apps, recipes ([about](https://www.cornpos.com/about-corn-point-of-sale-software)) | "Since 2010", 500–1 000+ claims (conflicting) ([about](https://www.cornpos.com/about-corn-point-of-sale-software)); 0 reviews on GoodFirms ([GoodFirms](https://www.goodfirms.co/software/corn-pos)) |
| **Foodnerd / OrderDock** | Lahore, 2016 ([G2](https://www.g2.com/sellers/foodnerd)); restaurants/cafés, KSA + PK | Not found | Cloud POS, kitchen + online orders, inventory, FBR, offline cash functions ([App Store](https://apps.apple.com/us/app/id1172262798)) | G2 4.5 from 2 reviews |
| **HysabOne** | GoodTech (Pvt) Ltd; accounting-first | F&B from PKR 3 499/month ([F&B](https://hysabone.com/industries/food-beverage/)) | Recipe costing, tables, FBR; KDS/PRA not mentioned | "500+ businesses" ([POS](https://hysabone.com/pos-software-pakistan/)) |
| **Amanat POS** | PK + KSA/UAE/UK listing | Rs 5 999/month per location ([GetApp](https://www.getapp.co.uk/software/2369211/amanat-pos)) | Tables, KDS, FBR, offline, multi-outlet, Urdu | No reviews |
| **Softvirtue** | Lahore, custom one-time build | PKR 80k–300k+ one-time ([site](https://softvirtue.com/software/point-of-sale)) | Offline, printed KOT, multi-branch stock | Not found |
| **Odoo + PRA module** | Integrators | PRA module $49–$112 ([HSxTech](https://apps.odoo.com/apps/modules/19.0/pra_pos_integration), [Affinity](https://apps.odoo.com/apps/modules/18.0/affinity_pos_pra_integration)) | Cloud API or local fiscal device, QR receipts | — |
| Square / Toast | **Pakistan mein nahi** ([Square](https://developer.squareup.com/docs/international-development/payments), [Toast](https://support.toasttab.com/en/article/Toast-Product-Availability-in-Australia-Canada-Ireland-and-the-United-Kingdom)) | — | — | — |

Local market price references: cloud POS ~PKR 5k–50k/month, on-prem with hardware ~PKR 200k–500k+ ([HysabOne blog](https://blog.hysabone.com/?p=66)). Oscar ke mutabiq market mein software Rs 1 500–5 000/month, FBR setup Rs 10k–50k ([Oscar](https://oscar.pk/solutions/free-pos)) — ye competitor ki marketing hai.

**Pagers:** kisi vendor ne mention nahi kiya (not found). **Waiter handheld:** sirf Oscar explicitly.

### 2.2 Legal must-haves (as of 2026-11-01)

**PRA (Punjab) — sab se ahem:**
- Turnover threshold e-IMS ke liye Rs 6 m/year bataya jata hai (pehle Rs 10 m) — sirf secondary sources ([TaxationPK](https://news.taxationpk.com/pra-lowers-threshold-for-electronic-invoice-monitoring-system/), [Faubix](https://einvoicing.faubix.com/guides/pra-eims-punjab)). Rule text khud nahi mila.
- Practice mein ye is se bhi wasee hai: Aug 2026 mein PRA ne restaurants, hotels, coffee shops, marriage halls ke liye **handwritten receipts poore Punjab mein ban** kar diye ([TechJuice](https://www.techjuice.pk/?p=247661), [Daily Pakistan](https://en.dailypakistan.com.pk/?p=336434)); Sept 2026 mein PRA ne kaha Rs 500 k/month tak wale bhi e-IMS se invoice dein ([TechJuice](https://techjuice.pk/pra-exposes-massive-tax-fraud-at-restaurants-in-four-cities)). Registration ka koi exemption threshold nahi ([PRA FAQ](https://reg.pra.punjab.gov.pk/ptms/Faqs.aspx)).
- Rates: cash 16%, card/wallet/QR **8%** from 1 Jul 2026 ([Geo](https://www.geo.tv/latest/673313-true-punjab-has-increased-sales-tax-on-restaurant-bills-paid-by-card-to-8), [Profit](https://profit.pakistantoday.com.pk/2026/07/01/punjab-increases-restaurant-sales-tax-on-digital-payments-to-8percent-from-today)).
- POS ko kya chahiye ([PRA Tech Spec 1.2](https://e.pra.punjab.gov.pk/templates/Technical_Specification_Software_Fiscal_Device_1.2_PRA.pdf), [PRA POS manual](https://e.pra.punjab.gov.pk/templates/POS_COMPONENT_and_eIMS_User_Manual.pdf)):
  - Har invoice real-time post; PRA fiscal invoice number wapis aata hai.
  - Do raste: **Windows-only** local fiscal component (`localhost:8524`), ya cloud `PostData` API (Bearer token, TLS 1.2, **production mein server IP whitelist**).
  - Fields: POSID, USIN, payment mode, invoice type (new/debit/credit), per item PCT code, tax rate, tax charged; returns ke liye RefUSIN.
  - Receipt pe PRA invoice number + QR code (verification URL).
  - Formal offline mode nahi; local component unsynced invoices queue mein rakhta hai.
- Kitchen slips, pre-bills, unpaid bills receipt ke taur pe ban ([ARY](https://arynews.tv/restaurants-and-diners-get-new-guidelines-in-punjab)).
- Vendor certification list: **not found** — POS ID taxpayer ke naam pe register hota hai, sandbox test POS IDs available hain.
- Penalties: Rs 400k–1 m aur repeat pe sealing up to a month ([TechJuice](https://www.techjuice.pk/?p=247661)); KPMG FY27 brief alag figures deta hai ([KPMG 2026](https://assets.kpmg.com/content/dam/kpmgsites/pk/pdf/2026/07/A-Brief-of-Provincial-Tax-Laws-2026.pdf.coredownload.inline.pdf)) — customer ko quote karne se pehle Act check karein.
- Enforcement: Oct 2026 mein 70+ restaurants ko notices, QR mandatory ([APP](https://www.app.com.pk/business/pra-to-strengthen-digital-monitoring-against-tax-evasion/)); Aug 2026 sealing ([Express Tribune](https://tribune.com.pk/story/2621399/pra-seals-three-premises)); bill pe tax aur records mein mismatch ko "deliberate misreporting" kaha, Lahore samet 4 shehar ([TechJuice](https://techjuice.pk/pra-exposes-massive-tax-fraud-at-restaurants-in-four-cities)).

**FBR:** Islamabad (ICT) ke Tier-1 restaurants pe FBR POS lagta hai, sealing hui hai ([FBR PR](https://www.fbr.gov.pk/pr/rto-islamabad-seals-two-restaurants-for-issui/174156)). Draft SRO 288(I)/2026 non-AC ke ilawa **saare restaurants** pe income-tax POS integration propose karta hai, FBR invoice number + QR, 24 h offline upload ([FBR SRO 288](https://download1.fbr.gov.pk/SROs/2026218112270512SRO288dated18.02.2026.pdf)) — **abhi draft hai**, final notification nahi mila; SRB/BRA objection ([Business Recorder](https://www.brecorder.com/news/40411087)). Final hua to Lahore ke AC restaurants pe PRA + FBR dono.

**SRB (Sindh):** hotels ke restaurants, franchises, multi-branch, AC malls, online marketplace pe bechne wale, ya Rs 5 m+ turnover — sab integrate ([SRB FAQ](https://www.srb.gos.pk/srb/faq/)). Card 8%, cash 15% ([KPMG 2025](https://assets.kpmg.com/content/dam/kpmg/pk/pdf/2025/07/A-Brief-of-Provincial-Tax-Laws-2025.pdf)). Non-conforming invoicing software supply karne pe **vendor** pe Rs 100k–1 m penalty ([KPMG 2026](https://assets.kpmg.com/content/dam/kpmgsites/pk/pdf/2026/07/A-Brief-of-Provincial-Tax-Laws-2026.pdf.coredownload.inline.pdf)).
**KPRA:** FY27 se POS vendors jo data suppress karein unpe Rs 500k ya 5% suppressed sales, aur POS providers jointly liable ([KPMG 2026](https://assets.kpmg.com/content/dam/kpmgsites/pk/pdf/2026/07/A-Brief-of-Provincial-Tax-Laws-2026.pdf.coredownload.inline.pdf)).
**BRA:** reduced 4% rate sirf POS-invoicing restaurants ke liye ([KPMG 2026](https://assets.kpmg.com/content/dam/kpmgsites/pk/pdf/2026/07/A-Brief-of-Provincial-Tax-Laws-2026.pdf.coredownload.inline.pdf)).

**Bina tax integration ke kis ko bech sakte hain?** Punjab mein sirf chhote, unregistered, non-AC dhabas/takeaways — aur woh bhi legal exemption ki wajah se nahi, sirf enforcement na hone ki wajah se. Ye segment POS ke paise kam deta hai aur hub hardware afford nahi karega. **Asal mein: bina PRA ke, Punjab mein koi qabil-e-farokht segment nahi.**

**Architecture implication (important):** aapka hub Linux hai (R19), aur PRA ka local fiscal component Windows-only hai. Matlab PRA ka raasta **cloud `PostData`** hai, static whitelisted IP se. Yani har bill ke liye: hub → cloud relay (static IP) → PRA, durable queue ke saath, aur receipt pe PRA number + QR. Offline mein kya print hoga (PRA number ke bina), ye policy decide karni hogi — FBR ke rule 24 h upload allow karte hain; PRA ka offline deadline not found. Ye 06 (sync) aur 05 (billing) ko seedha affect karta hai — isliye isko "end" pe rakhna design risk bhi hai.

### 2.3 Pakistani owners ki shikayaten (evidence kamzor hai)

Direct owner reviews / Reddit / Facebook posts **nahi mile**; local POS ke reviews taqreeban zero. Jo strong evidence hai woh regulator aur macro data hai:
1. **Tax compliance pressure + sealing** — strong (upar 2.2).
2. **Sales suppression / record manipulation** — strong as pattern: food chains sealed for concealing sales ([APP](https://www.app.com.pk/?p=1139686)), Islamabad restaurants sealed for fake receipts caught via POS tracking ([ProPakistani](https://propakistani.pk/2024/11/21/five-popular-restaurants-in-islamabad-sealed-for-issuing-fake-invoices/)). Void abuse jaisi specific techniques: not found.
3. **Government POS systems unreliable** — FBR retail side pe: disconnections, invoice sync failures ([Profit](https://profit.pakistantoday.com.pk/?p=190179)); Tax Ombudsman ne sealing roki jab tak fix na ho ([Profit](https://profit.pakistantoday.com.pk/?p=201924)). PRA-specific: not found.
4. **Internet** — 2024 mein internet disruption se economic loss duniya mein sab se zyada, ~$1.62 bn ([LUMS MHRC](https://mhrc.lums.edu.pk/pakistans-digital-dilemma-true-cost-internet-shutdowns)); May 2023 shutdown mein POS card transactions ~50% gire ([ARY](https://arynews.tv/tag/point-of-sale-transactions)).
5. **Bijli** — Feb 2026 mein 2 000+ feeders pe 10 h+ load-shedding, zyada tar QESCO/PESCO/SEPCO/HESCO; LESCO mein 10 h+ wala koi nahi ([The News](https://www.thenews.pk/print/1398879-more-than-2-000-feeders-face-over-10-hours-of-daily-loadshedding-na-told)).
6. **Foodpanda** commission aur support complaints — medium, thoda purana ([Arab News](https://arabnews.pk/node/1735986)).
7. Local POS mein offline/report gaps — weak, ek do anecdotes ([SoftwareSuggest](https://www.softwaresuggest.com/point-of-sale-pos-software/pakistan)).

Staff theft in Pakistani restaurants, Urdu UI complaints, hardware complaints: **not found online.** Ye sirf interviews se pata chalega.

International: Toast ki sab se bari shikayat support aur hidden costs ([Capterra](https://capterra.com/p/136301/Toast-POS/reviews/)); Square: internet jaaye to tickets aur KDS se print dono gaye ([GetApp](https://www.getapp.com/retail-consumer-services-software/a/square-for-restaurants/)). Ye aapki offline-hub thesis ko support karta hai.

### 2.4 Regional benchmarks

- **Foodics (KSA/MENA):** ~$198 m raised, 40 000+ branches, KSA/UAE/Egypt/Jordan/Kuwait; Pakistan nahi ([Forbes ME](https://www.forbesmiddleeast.com/lists/the-middle-easts-fintech-50-2026/foodics/)). UAE: AED 199 / 375 / 556 per month (Starter → Advanced), inventory + tables Basic se, loyalty + aggregators + API Advanced mein ([Foodics UAE](https://www.foodics.com/foodics-pricing-uae/)). ZATCA e-invoicing compliant.
- **Petpooja (India):** 100 000+ clients, $15.5 m Series C Sep 2025 ([Entrackr](https://entrackr.com/news/petpooja-raises-155-mn-series-c-at-over-3x-valuation-premium-10512396)); tiers ~$67–$333/year + GST, captain (waiter) app + KDS + e-invoicing top tier mein ([SoftwareSuggest](https://www.softwaresuggest.com/petpooja/pricing)).

Sabak: in dono ka moat **tax compliance + integrations + distribution** hai, timing engine nahi.

---

## Part 3 — Verdict

### 3.1 Comparison table

Legend: ✅ built · 📝 planned only (spec/story) · ❓ not found · — n/a. Competitor columns vendor claims hain, verify nahi.

| | **Aapka POS — built** | **Aapka POS — planned** | Blink | Oscar | CORN | HysabOne / Amanat | Foodics (MENA) |
|---|---|---|---|---|---|---|---|
| Offline-first | ✅ hub + SQLite durable; lekin order flow nahi | 📝 06 full | ✅ claim | ✅ sync claim | ✅ claim | Amanat ✅ claim | ❓ |
| Anti-theft approvals + audit | ✅ event log, approver role lists (data only) | 📝 04 voids, 01d approvals on own device | ❓ | ❓ | ❓ | ❓ | ❓ |
| Kitchen timing / KDS | ❌ (engine 203 lines) | 📝 03a hold-and-fire ETA, 03b KDS | KOT ✅, KDS ❓ | ✅ KDS | ✅ KDS | Amanat ✅ KDS | ✅ (KDS) ❓ details |
| Floor service (assembler, pagers) | ❌ | 📝 tables, handover with acceptance, notifications | ❓ | ✅ staff ordering app | ✅ tables | ✅ tables | ✅ tables (Basic+) |
| Staff performance data | ❌ | 📝 R25 (not matured) | ❓ | ❓ | ❓ | ❓ | ❓ |
| Inventory | ✅ pre-cooked stock counts | 📝 recipe module (R28), after 02/04 | ✅ | ✅ recipes | ✅ recipes | ✅ recipe costing | ✅ Basic+ |
| Owner remote view | ✅ config only (owner app) | 📝 07 sales dashboard | ✅ analytics | ✅ owner app | ✅ owner app | ❓ | ✅ |
| Multi-branch | ✅ data model + per-branch price | 📝 milestone B | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tax integration PRA/FBR | ❌ | 📝 milestone C (end) | "tax integrations" (names ❓) | "FBR, SRB, PRA ready" | ✅ PRA, SRB | FBR | ZATCA |
| Price | — | not decided | $25–75/branch/mo | free + 1.2% card | $50–130/branch/mo | Rs 3.5k–6k/mo | AED 199–556/mo |
| Hardware | needs **dedicated hub PC + UPS** + tablets | Android tablets in device-owner mode | ❓ | free card machine | ❓ | ❓ | quoted after demo |
| Maturity / customers | 0 live | pilot 1 branch | 3 000+ brands claim | named chains | 500–1 000 claim | 500+ claim | 40 000+ branches |

### 3.2 Kahan aage, kahan peeche, kahan barabar

**Genuinely aage (design level par — abhi code mein nahi):**
- Offline-first **LAN hub** with durable event log: Pakistan ke internet/bijli ke liye cloud-POS se behtar architecture. Ye real hai aur built bhi hai (sirf order flow nahi).
- Audit-first + custom approver roles + "approve on your own device": anti-theft angle jo koi competitor clearly market nahi karta (not found). Ye aapka sab se strong wedge ho sakta hai — **jab bane.**
- Kitchen timing (hold-and-fire, pot/batch stations) desi menus (paye, nihari, karahi) ke liye — idea mein unique. **Lekin engine exist nahi karta**, aur ye un-validated hai ke owner iske paise dega.

**Peeche (aaj aur pilot ke baad bhi):**
- Order, KDS, print, bill — sab. Competitors ke paas ye base hai.
- **Tax integration** — Oscar/CORN claim karte hain, aapka plan "end" pe hai. Punjab mein ye deal-breaker hai.
- Foodpanda / delivery integration, loyalty, online ordering — plan mein bhi nahi (P2/P3).
- Payments/card machine, bank settlement (Blink Pay, Oscar free card machine) — nahi.
- Hardware friction: dedicated hub PC + UPS ek extra cheez hai jo cloud/Android POS ko nahi chahiye.
- Distribution, brand, references: zero vs named chains.

**Barabar (ya hone wala):** multi-branch data model, menu variants/modifiers/deals (aapka 01c kaafi complete hai), roles/permissions.

### 3.3 Realistic pehle customers — aur kis ke liye NAHI

**Pehle customers:**
- **Lahore**, registered (PRA wale), **desi high-volume** restaurants: paye/nihari/haleem/karahi/BBQ, 1–5 branches, dine-in floors + takeaway, din mein ~500–2 000 orders.
- Owner jo har waqt counter pe nahi hota aur cashier/waiter ki chori ya void abuse se pareshan hai.
- Jo already PRA notice/sealing ke darr mein hai aur moujooda vendor se naraz hai (support, downtime).
- Ideally aapke father ke network se: wholesale suppliers, Anarkali/Gawalmandi/Mozang type food streets ke familiar owners — warm intros.

**Kis ke liye NAHI (abhi):**
- Chhote dhabas/takeaways — paise kam, hub hardware afford nahi, aur unke liye PRA bhi abhi pressure nahi.
- Cafés/QSR jo loyalty, online ordering, Foodpanda pe chalte hain — Blink/Oscar wahan aage hain.
- Bari chains (OPTP, Cheezious level) — ERP, integrations, procurement, SLA; solo dev support nahi de sakta.
- Cloud kitchens — aggregator integration chahiye.
- Sindh/KP/Islamabad — jab tak SRB/KPRA/FBR adapters nahi.
- Gulf/Canada — ZATCA/UAE e-invoicing aur local support ke bina bilkul nahi; abhi soch bhi nahi.

### 3.4 Top 5 risks + ek-ek mitigation

| # | Risk | Mitigation (concrete) |
|---|---|---|
| 1 | **Legal (PRA):** bina e-IMS ke Punjab mein bechna practically band; KPRA/SRB vendor pe bhi penalty. Pilot "parallel billing" mein bhi do systems ke sales figures alag hon to "mismatch" ka sawal uth sakta hai | PRA sandbox pe **December mein** adapter banao (cloud relay, static IP, durable queue, QR + PRA number, PCT codes, credit notes). Pilot ke dauran naya POS **sirf kitchen/internal** documents print kare, "bill" jaisa kuch nahi; real bill PRA-integrated system se hi. Pilot ka 2nd month: naya POS khud PRA invoice kare |
| 2 | **Scope / solo-dev time:** 7 modules baqi, full-time job, spec process heavy, Ramadan clash | "Pilot-Min" cut (3.5) aur dates: shadow mode late Jan, go-live Eid ke baad. Har module spec ≤ ~300 lines, hostile review sirf 02 (orders) aur PRA pe |
| 3 | **Support burden:** on-prem hub har restaurant pe, rush mein outage = phone aapko; solo dev | Remote update + health heartbeat + remote shell (milestone C se pehle); ek spare pre-imaged hub box per city; pehle 10 customers sirf Lahore; support price mein shamil |
| 4 | **Pricing / competition:** Oscar free hai, Blink $25 se, HysabOne Rs 3.5k se; aap ke paas hardware cost extra | Features pe nahi, **ROI pe becho**: "voids/discounts mein X% kami, kitchen se late orders kam" — pilot se number lao. Hub hardware ko bundle/lease karo, monthly mein |
| 5 | **Market evidence sirf ek customer (father) se:** biased, aur online owner complaints ka data almost zero | Ab se January tak **10–15 Lahore owners se interviews** (R25 jaise ideas yahin validate hon); 3 se letter of intent / paid pilot commitment |

### 3.5 Bechne ke qabil banane ke liye pehle 5 kaam — order mein (cut list ke saath)

1. **Scope cut ("Pilot-Min") — is hafte.** Pilot = ek branch: cashier + order-taker (tablet browser, not device-owner app) + KDS + printer + bill + nightly backup.
   - **Cut / freeze:** 01d ki escalation, alert state machine aur device-owner Android app (approval = manager PIN on same screen, ye spec mein fallback ke taur pe already hai); R23 table handover with acceptance; R24 teams; R25 workload stats; Windows hub path; statement-count bound tests (sirf hot paths pe rakho); purani spec version files repo se `docs/archive/` ya delete.
   - 01d ka jo 5 tasks bana hai woh rakho, baqi park.
2. **02 Orders + 03b KDS/print + 05 basic billing — vertical slice, shadow mode by late January.** Timing engine ka sirf v0: fixed cook time per station + "late" flag. Hold-and-fire ETA tab banao jab data ho (aapki apni D23 bhi yahi kehti hai).
3. **PRA e-IMS adapter — milestone A ke foran baad, C se nikaal ke.** Sandbox abhi se. Ye sellability ka darwaza hai, feature nahi.
4. **Anti-theft wedge: 04 voids/discounts with approval + immutable audit + owner ka daily WhatsApp/phone summary** (07 ka chhota slice). Yahi pitch hai jo Oscar/Blink nahi bolte.
5. **Process change:** spec → plan → build ko lighter karo (as-built docs, ek review pass), aur **har hafte do ghante sales/discovery** (owner interviews, PRA-pressured restaurants list). Installer/onboarding script + remote update isi window mein, kyunke 2nd customer bina iske nahi lag sakta.

### 3.6 Scores (out of 10)

| Area | Score | Ek line mein wajah |
|---|---|---|
| Engineering | **7 / 10** | Durable event-sourced hub, idempotency, tenant guards, 1 354 tests green — lekin formatter nahi, hot-path inefficiency, do UI stacks, aur process code jitna bhari. |
| Product completeness today | **1.5 / 10** | Ek order nahi le sakta; sirf setup/admin bana hai. |
| Market fit | **5 / 10** | Offline-first + anti-theft + kitchen timing desi high-volume ke real dard ko target karta hai, lekin unvalidated hai, PRA ke bina Punjab mein illegal-to-buy, aur hub hardware friction hai. |
| Sellability within 6 months after pilot | **3 / 10** | PRA adapter, onboarding, remote support aur 2–3 references sab chahiye; solo + full-time job pe 6 mahine tight — Pilot-Min + PRA pehle karo to ~5 tak ja sakta hai. |

---

## Appendix — key file references

- Module map / milestones: `docs/specs/README.md:11-35`; R13 PRA deferred `:104`; R20 parallel billing `:111`; R33/R34 on `module-01d`.
- Hub write path: `apps/hub/src/engine-host/writer.ts:54-94`; DB pragmas `apps/hub/src/db/connection.ts:6-9`.
- Command route: `apps/hub/src/commands/route.ts:81-98` (idempotency + auth), `:101-119` (indentation), `:120-131` (redundant queries).
- Client entries: `apps/client/vite.config.ts:5-8`.
- Engine: `packages/engine/src/` (203 lines non-test).
- Root-only test failure: `apps/hub/test/db/pre-migrate-backup.int.test.ts:116-127`.
- 01d progress: `docs/plans/01d-status.md` (branch `module-01d`).
