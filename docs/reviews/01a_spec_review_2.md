CHANGES NEEDED

# 01a spec review 2 — `01_Restaurant_Setup_Spec_v0.7.1.md`

Reviewer stance: hostile, did not write the spec. Scope: what changed since review 1 (v0.7 owner answers, v0.7.1 business day), plus a re-check of review 1's fixes. Read: spec v0.7.1 in full; foundation v1.7 §6 and the sections the spec cites; spec 00 v1.2 §4.2 and M19/M47; stories E0 availability AC4–5, E1 stock; code `apps/cloud/src/cli/issue-registration-code.ts:55–69`, `apps/cloud/src/plugins/jwt.ts:61–68`, `apps/cloud/src/modules/owner-auth/service.ts:251`, `apps/hub/src/setup/cloud-client.ts:35, 66`, `apps/hub/src/db/migrations/0001_event_store.sql:18`, `apps/cloud/src/db/migrations/0001_platform.sql:57`. [ASSUMPTION] content is not judged; its isolation is checked at the end.

Summary: 1 Blocker, 7 Should-fix, 10 Nits. The blocker is the business-day model: after the first day, nothing ever asks anyone to start a new day, so the failure S41 exists to prevent comes back every morning someone forgets.

---

## Blocker

### B1. After the first day, a day never ends unless someone remembers to end it (S33, §6.18a, §8.2, S41)

**What the spec says.** v0.7.1 makes a day open until an explicit "End the current day and start a new one?" (S33 c). `409 BUSINESS_DAY_NOT_OPEN` and the large **Start day** action appear only while `state.business_day` is null (§6.17, §8.2), which is true **once in the life of a hub**: before its first open. There is no day close in 01a (05 owns it, §4.4).

**Failure scenario.** Day 1: the manager taps Start day at 09:00, counts 4 karahi pots. Closing at 01:00: the 4 leftover pots are thrown away. Day 2, 09:30: the manager opens `/admin/stock`, sees "Day open: Mon since 09:00 (24 h)" in warn style (§8.2), types today's counts for a few items and saves; nothing stops it, because a day *is* open. Items they did not re-count keep yesterday's numbers as **valid** (`set_at` ≥ yesterday's `opened_at`), so `availableStock` reports "4 left" and 02/03a give stock-time ETAs for food that does not exist (E1 stock AC1, AC6; the exact failure S41 names). If the manager does press End day *after* counting, every count they just typed reads 0 (`set_at < opened_at`). The owner's instruction for v0.7.1 ("the stock page shows a large Start day action right there, one tap, then the entry continues") assumes the 409 fires each morning; under this model it never fires again. The spec even lists the case as an accepted risk (§7.6 "Nobody ends yesterday's day"), which contradicts S41's purpose.

**Fix (owner decision; one of):**
- (a) **Give the day a closed state.** Add `CloseBusinessDay` (or make the explicit end close the day, and `OpenBusinessDay` open a new one only when none is open): `EngineState.business_day.closed_at`; stock commands answer `409 BUSINESS_DAY_NOT_OPEN` while the day is closed; the stock page shows the large Start day action whenever no day is open. Closing is the last action of the night (end of shift), so the morning's first stock action naturally hits Start day. 05 later replaces both commands with shift close/open and keeps the events.
- (b) Keep one command but make the page's morning path safe: when the open day is older than a stored threshold (a setting, P2), the page shows Start day as the primary action **before** the count rows and disables Save counts until the user either starts a new day or confirms "continue the same day". This keeps 01a smaller but still relies on a heuristic.

Either way, add a test: day open at 09:00, no explicit action, next morning 09:30 a Save counts is either refused with the Start day action (a) or blocked behind the choice (b); and the runbook's morning step.

Also decide who may end a day: today any `manage-stock` holder (a cook, once 01b assigns stock counting) can zero every count mid-service with one confirmation.

---

## Should-fix

### S-1. The stock check uses "> 0" or "≥ one unit" where it must use the line's quantity (S14, §4.4 03a, S44)

**Says.** S14: "pre-cooked stock > 0" means `availableStock(…) > 0`. §4.4 03a: ETA uses `availableStock(…) ≥ stock_per_sale_unit`.

**Failure.** Pot counted in grams, plates of 250 g: available 100 g → `> 0` is true, so an order gets a stock-time ETA for a plate that cannot be served. With the 03a wording: weighted item (`sale_unit 'g'`, factor 1), available 300 g, order 500 g → `300 ≥ 1` passes and the line is quoted from stock. Two plates ordered with 300 g left (one plate's worth) → also passes.

**Fix.** One contract in §4.4 and S14: a line is served from stock only when `availableStock(…) ≥ quantity × stock_per_sale_unit`; otherwise 03a follows `out_of_stock_behaviour` (and defines whether a partial line splits). Replace every "> 0" for stock-tracked items with this, and give it a function in `@pos/engine` (`canServeFromStock(available, quantity, stockPerSaleUnit)`) so 02's clients and 03a use the same rule.

### S-2. A count in a new unit, or over a stale count, leaves `reserved` in the old terms (S14, S44, S45)

**Says.** `StockSet`: `on_hand = count`, `unit` = the event's unit, `reserved` unchanged. A count in another unit is the way to recover from a unit change (S44).

**Failure.** Item stocked in pieces with 2 plates reserved (`reserved 2`). The owner switches `stock_unit` to `g` (250 g per plate). The manager counts 2 000 g → `{ on_hand 2000, reserved 2, unit 'g' }`: `available = 1998 g`, i.e. the two open plates now hold 2 **grams**, and when 03a hands them over it removes 2 × 250 g from `on_hand` and 2 × 250 from `reserved` (going below 0, breaking the S14 invariant) or uses the wrong unit. The same mix happens after `stock_per_sale_unit` changes if 03a releases with the current factor instead of the copied one.

**Fix.** S14: a `StockSet` whose `unit` differs from the entry's `unit` is a re-plan point like `on_hand < reserved`: carry to 03a that it releases and re-reserves every open reservation of the item in the new unit (or re-plans them at full cook time). State that reserve, release and hand-over always use the order line's **copied** `stock_per_sale_unit` (§4.4 02 copies it). Add an engine test with a unit change while `reserved > 0`.

### S-3. The 01a / 01c boundary leaves what 02's order line needs undefined (S12, §4.4, §12.5)

**Failure scenarios.**
- **Shared stock across variants.** Karahi Half and Full come from one pot. In 01a each item has its own stock entry, so the two sizes cannot draw from one count; 01c's scope says "per-variant … stock where they differ" but nobody says where the shared count lives (`item_id` of the parent? a stock key?), and `StockSet`/`StockReserved` are keyed by `item_id` (§4.2). 02 cannot write the line's stock reference.
- **Weighted line total.** §4.4 02 says 02 (with 05) defines the line total and rounding for g/ml; §12.5 puts weighted items in 01c. Two owners, or none.
- **`group_label` removal.** 01c "may replace `group_label`", but it is a required field of snapshot schema 1 (§4.3). If 01a is live on the pilot hub before 01c, removing it is a breaking change (S28 b: a release of the cloud and every hub together); the spec does not say so.
- **Windows and modifiers.** Whether modifier options and deal parts have availability windows, stock and stations is unsaid.

**Fix.** In §12.5 01c, list what 01c must define for 02 (it is a contract between unwritten specs, so write it as the 01c entry criteria): the line's identity (item + variant), the stock key a variant reserves from and its factor, the weighted line total and rounding owner (pick one: 01c), modifier and deal-part line shapes, their routes/stock/windows. In §4.4 02, point at that list instead of "follow 01c". In S12, say `group_label` stays in schema 1 and becomes optional-and-ignored if 01c supersedes it (S28 c), so no breaking release is needed.

### S-4. `localTimeOfDayMs` in the browser uses the device's time zone and clock (S47, §4.2, §4.4 02)

**Says.** `localTimeOfDayMs(nowMs)` lives in the browser-safe `@pos/domain` root and "uses the runtime time zone"; clients must evaluate windows "against the hub's clock and time zone, not the device's (02 defines how)".

**Failure.** A kiosk whose OS is on UTC, or a phone with the clock 20 min fast, calls the shared helper exactly as its name suggests and greys out breakfast at 08:00 local or keeps it orderable 20 min too long; the hub then refuses the order, and the order taker sees an item offered that cannot be sold. Also nothing re-evaluates at a boundary minute: no event fires at 13:00, so a screen left open keeps its old state.

**Fix.** Give the helper the offset explicitly: `localTimeOfDayMs(nowMs, utcOffsetMs)`, and have the hub publish its time once in 01a, where 02 can read it: e.g. `hub_time: { now_ms, utc_offset_ms }` in the catch-up `branch_config` part and in §6.23. Carry to 02: clients compute `hub_now = now_ms + (Date.now() − received_at)` and re-evaluate windows each minute. Add the offset case to test 136.

### S-5. A 5 000-item menu blocks the hub's event loop for over a second, during service (S48, §7.5)

**Says.** Hash and Zod parse run "outside the writer", ≤ 1.5 s at 5 000 items; the stock page re-reads every item every 15 s.

**Failure.** The hub is one Node thread. A 1.5 s synchronous `JSON.parse` + `canonicalJson` + `sha256` + Zod parse stalls every HTTP request, every WS frame and (with 03a) every fire tick for 1.5 s, whenever the owner edits a price at lunch. "Outside the writer" does not help: the event loop is the bottleneck. Boot step 5 pays the same again. Separately, each open stock page pulls about 2.5 MB of JSON every 15 s (every item, with windows and levels), which the hub serialises on the same thread.

**Fix.** Either (a) run hash + parse in a `worker_threads` worker (Node built-in, no dependency) and hand the parsed snapshot back, or (b) set a §7.5 target that bounds the main-thread pause (e.g. ≤ 100 ms per slice) and defer apply until the writer is idle. For the stock page, add `category_id` / `q` parameters to §6.19 (still 1 statement) or return only stock-tracked and off/outside-window items by default.

### S-6. `can_edit_tenant` and the S8 guard read the JWT's branch list, which goes stale when a branch is added (S8, §6.11, §8.1)

**Code.** `issue-registration-code.ts:55–69` inserts a new branch and appends it to every owner's `owner_users.allowed_branch_ids`; the JWT carries `allowed_branch_ids` as a claim (`plugins/jwt.ts:61–68`) and is refreshed from the row only on refresh (`owner-auth/service.ts:251`).

**Failure.** The owner is logged in; the installer issues a registration code for branch D. Every tenant-wide save now answers `403 tenant_wide_write`, and `GET /v1/admin/menu` says `can_edit_tenant: false`, so the owner page opens read-only for the owner of every branch, until the access token is refreshed. A `pending_hub` branch (`0001_platform.sql:57`) counts too.

**Fix.** S8 and §6.11: compare against the owner's `owner_users.allowed_branch_ids` row read in the same transaction (one statement), not the claim; or keep the claim and have the owner page refresh the token once on `can_edit_tenant: false` or a `403 tenant_wide_write` before showing read-only. Add a test: branch added after login → menu save still `200` (or `200` after the one refresh).

### S-7. P2: restaurant-specific choices are written into the spec as constants, and one unasked decision is not isolated (S33, S47, §12.7)

- **`DAY_OPEN_GUARD_MS = 4 h`** (S33 c) is a threshold, and P2 lists thresholds as data. A restaurant with a breakfast shift and a dinner shift less than 4 h apart could never start the second day.
- **"A manual On does not override a window"** (S47) was decided in v0.7 without an owner answer (the owner said only that Off wins); it overrides story AC5 and is not in §12.7.
- **`price_minor` ≤ 10 000 000 00 "(₨10 m)"** (§3.3) ties a validation bound to PKR in a multi-restaurant product (P1).

**Fix.** Store the guard as a branch setting row with default 4 h (or record in S33 that it is a product constant, not restaurant behaviour, and why); add "manual On vs window" to §12.7 with the one place it changes (`in_window` evaluation); state the price bound per `currency_code` or as minor units without a currency symbol.

---

## Nits (10)

1. **§3.2 / S14 fold:** `StockAdded` keeps the entry's `unit` and ignores the event's. Say the fold rejects (throws) a `StockAdded` whose `unit` differs from the entry's, so a bad event cannot silently add grams to pieces; and say `on_hand` has no upper bound after adds (or cap it).
2. **§6.1, S27 (iii), S48 b:** the gzip path sends a `Buffer`, which Fastify does not pass through the Zod serializer. Say both paths send the bytes of `JSON.stringify({ data })` built from the same `wire`, so the plain and gzipped bodies are identical after decompression.
3. **§6.11:** "never repeats or skips a row that stays in the result" is false for a rename between pages (the row moves across the cursor). Say a rename can move an item; the page de-duplicates by `item_id`.
4. **§4.3, S47:** windows are "sorted by `start_ms`"; two windows with the same start sort undefined. Sort by `start_ms`, `end_ms`, `window_id`.
5. **§8.2:** the warn style "when the label differs from `hub_local_date`" fires every night after midnight during a normal late service. Base it on the day's age (or on B1's closed state), not on the date.
6. **S46, §8.2:** in 01a the low/out alert is only on `/admin/stock`, whose admin session idles out because its poll is not activity (M59). During service nobody sees it until 02. Say so in S46.
7. **S46:** `out` fires for every `cook_fresh` stock-tracked item that ran out, which is normal for those items (they fall back to cook time). Say whether `out` is shown for `cook_fresh` items, or the alert bar will be permanently full.
8. **§5.2, S46:** `low_stock_threshold` is tenant-wide, while stock is per branch, so a small and a large branch share one threshold. Record it as a known limit (P1 forbids adding the setting unasked).
9. **§8.1, S44:** changing `stock_unit` on the owner page silently makes today's count read 0 at every branch (S41). Show a warning on that field.
10. **§10.5f, test 135, §11:** test 135 is cited by two build steps ("category part", "item part"), and 131/132/116 also have unit and hub parts. §12.1 says each number is cited by exactly one test. Either split them into numbers or extend S40 N11's rule to "parts" in §12.1.

---

## Re-check of review 1's fixes after v0.7 / v0.7.1

| Review 1 item | Still holds? | Note |
|---|---|---|
| B1 S28 e re-apply loop | Yes | Negotiation stays removed; gzip does not touch the hash (§6.1) |
| B2 silent apply failure (S43) | Yes | Unchanged; parse outside the writer does not change the per-part retry |
| S-1 wire hash (S27) | Yes | See nit 2 for the gzip path |
| S-3 count valid for one business day | Changed | Now per item (`carries_over`) and per opened day; **broken in practice by B1** |
| S-4 every confirmed count appends `StockSet` | Yes | Now with `unit` |
| S-5 `on_hand < reserved` carried to 03a | Yes, incomplete | Unit change adds a second mix case (S-2) |
| S-6 archived tax classes/programs stay | Yes | |
| S-7 tenant-wide write guard (S8) | Yes, with S-6 | `can_edit_tenant` added; stale-claim case is new |
| S-9 boot placement | Yes | Step-3 fold now also reads `BusinessDayOpened` from the `hub` stream (`events_stream` index covers it) |
| S-10 on-site release | Yes | |
| S-11 happy-path / merged-row tests | Yes | Merged-row rule extended to units (test 128) |
| S-12 idempotency hash and prune | Yes | |
| Nits 1–10 | Yes | |

## Assumption isolation

| Assumption | Isolated? |
|---|---|
| S32 `out_of_stock_behaviour` (question 3) | Yes: column default; 02/03a branch on the value |
| S11 same menu and prices (question 5) | Yes |
| `stock_per_sale_unit` (decided, not asked) | Yes, listed in §12.7; but S-1 and S-2 show its contract with 03a is incomplete |
| 5 000-item design size | Yes, listed; S-5 shows a §7.5 target is missing for the hub's main thread |
| Manual On does not override a window (decided, not asked) | **No**: not in §12.7 (S-7) |
| 4 h double-tap guard | Owner-given; P2 question in S-7 |
