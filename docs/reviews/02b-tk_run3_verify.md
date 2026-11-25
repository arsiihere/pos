# 02b-TK pilot package — run 3 verification

**Verdict — FIX FIRST**

Reviewed `origin/module-02b-tk` at `c97f0f783aa7668bb05c064c57768bae3ea034dc` against the eight run-3 reviews, AGENTS.md, the binding D1–D9 decisions and the owner rulings. Evidence line numbers refer to that commit. Prior finding counts cover BLOCKER and MAJOR. Acceptance cases were inspected in the specs.

- **Prior findings:** 59 verified, 4 not fixed (1 BLOCKER and 3 MAJOR), out of 63.
- **New findings:** 0 BLOCKER, 2 MAJOR, 3 MINOR.
- **OWNER questions:** None. The binding decisions and existing product rulings resolve the choices needed here.

## Source reviews

| Spec | Run-3 source |
|---|---|
| 03a | [Timing Engine](https://github.com/arsiihere/pos/blob/ebe3cd4b/docs/reviews/03a_v1.2.11_hostile_run3.md) |
| 05 | [Billing](https://github.com/arsiihere/pos/blob/75055c64/docs/reviews/05_v1.0.35_hostile_run3.md) |
| 02b | [Ordering](https://github.com/arsiihere/pos/blob/0fdf734b/docs/reviews/02b_v1.0.25_hostile_run3.md) |
| 03b | [KDS and Pass](https://github.com/arsiihere/pos/blob/b6130d3c/docs/reviews/03b_v1.0.16_hostile_run3.md) |
| 01d | [Notifications and Requests](https://github.com/arsiihere/pos/blob/b74806cf/docs/reviews/01d_v1.3.7_hostile_run3.md) |
| 01b | [Staff and Roles](https://github.com/arsiihere/pos/blob/dcdb788b/docs/reviews/01b_v1.12_hostile_run3.md) |
| 01a | [Restaurant Setup](https://github.com/arsiihere/pos/blob/6bed4519/docs/reviews/01a_v2.11_hostile_run3.md) |
| 00 | [Hub Platform Access](https://github.com/arsiihere/pos/blob/05628c56/docs/reviews/00_v1.13_hostile_run3.md) |

## Prior BLOCKER and MAJOR findings

Finding IDs are local to each review. A verified row covers the defect identified in that review. Cross-spec defects with distinct fixes appear separately below.

| Finding | Result | Evidence |
|---|---|---|
| 03a R3-B-1 | Verified | §3.5.8 PK-5, ll. 920–921, preserves both pickup timestamps and sets boost. §10 #186, #189 and #191, ll. 1935–1940, keep an order unready while its drink is unfinished, including on recovery. |
| 03a R3-M-1 | Verified | §3.8 ll. 1011–1012 uses effective pickup in the common slip-group set. #190(f), l. 1939, covers drinks-only resolution, surviving sync slip and no new held-drink warning. |
| 03a R3-M-2 | Verified | §3.5.7 PR-4 and §3.5.8 PK-1/5/7, ll. 901, 911, 920, 923, apply the effective floor throughout scheduling. #186, l. 1935, covers preview, fold and capacity replan of a later addition. |
| 03a R3-M-3 | Verified | §3.5.8 PK-5 and §3.9 ll. 921, 1050–1052 release and rebook only own unfired held FIFO. #186 preserves an older booking and recomputes the sync floor. |
| 03a R3-M-4 | Verified | §3.5.8 PK-1 l. 911 keeps the submit gap and preview promise while allowing placement reversal. #180 l. 1929 constructs that boundary and checks replay. |
| 03a R3-M-5 | Verified | §3.5.8 PK-9 l. 925 and §4.3 l. 1270 defer normalization until 02b validates the queued submit, including `no_time_left` and `other_day`. |
| 05 R3-B-1 | Verified | §§6.2–6.2a ll. 1257–1268 sum open split balances. #60e l. 1781 gives Rs 500 with a paid closed sibling split and Rs 400 with Rs 600 paid against Rs 1,000. |
| 05 R3-M-1 | Verified | §§6.3–6.3a ll. 1274–1276, 1286–1288 publish gross and payable separately. #60i l. 1785 tests Rs 700 gross and Rs 600 payable. |
| 05 R3-M-2 | Verified | §6.3a ll. 1286, 1290 checks target type, date and cancellation in the existing target read. #60i asserts 404/422 and zero writes. |
| 05 R3-M-3 | Verified | §6.3a l. 1282 applies `billAccess` even to closed targets. #60i l. 1785 refuses the other cashier’s addition and accepts the plain draft. |
| 05 R3-M-4 | Verified | §§6.12–6.13 and §6.25 ll. 1365, 1369, 1456 separate list reuse from conditional close/result work. #60j–k ll. 1786–1787 cover last, empty and day close. |
| 05 R3-M-5 | Verified | §6.3a ll. 1283–1291 and #60h l. 1784 use the nested addition ID and event/audit effects. 02b §8 l. 928 agrees on the envelope and a routed print’s effects. See V-02 for output on a closed target. |
| 05 R3-M-6 | Verified | §6.3a l. 1289 and 02b TK-15 l. 497 both bound routed/explicit/no-route at 5/4/2 and addition at +5. |
| 05 R3-M-7 | Verified | §§6.29–6.30 ll. 1531, 1539 register v1 and an always-false audience. #91b l. 1838 asserts zero recipients and one audit row. |
| 02b R3-B-1 | Verified | §6.12a l. 701 points to the single 01d §5.4 definition. 01d l. 1678 freezes all three historical permission fields and defines identity upcast and replay. |
| 02b R3-B-2 | Verified | §4.5 TK-12 l. 494 and §11 task 23 l. 1117 depend on the 01d pilot slice. §5 l. 600 assigns the migration at merge without a 05c slot. |
| 02b R3-M-1 | Verified | §§3.1, 3.8 and 4.2 ll. 250, 348, 441 distinguish stored pickup and effective hold, including the no-engine fallback. #67 l. 1042 checks an unmade engine drink after Boost. See 03b R3-M-9 for the separate clock mismatch. |
| 02b R3-M-2 | Verified | §§3.7a, 6.4a and 6.19 ll. 340–342, 642–643, 857–861 scope dedupe and approval to a single order. #89/#92 ll. 1064, 1067 cover changes in due and a second requester. |
| 02b R3-M-3 | Verified | §§3.7a, 6.4 ll. 343, 637 define first-close-wins, the void follow-up and batched reads. #88/#91 ll. 1063, 1066 isolate the closers. 04 v1.0.9 §§6.1–6.2 carry the owning void follow-up. |
| 02b R3-M-4 | Verified | §6.4 ll. 633–635 and §8 ll. 923, 931–932 compare actual send IDs per order, account for partial sends and recheck current permission and due in the writer. #90 l. 1065 covers mixed selections. |
| 02b R3-M-5 | Verified | §6.19 ll. 857–861 defines batched contact-free invalidation across payment, comp and line changes. §8 l. 912 refetches on it. #93 l. 1068 covers the refresh. |
| 02b R3-M-6 | Verified | TK-15 l. 497 and §8 l. 928 match 05 §6.3a on the nested payload, guards, bill access, successful-print effects and read bounds. #73 l. 1048 covers screen dispatch. See V-02. |
| 02b R3-M-7 | Verified | §§3.3, 6.18a and 8 ll. 289, 817, 925 separate authorized catch-up contact from search membership, including the day-close transition. #79 l. 1054 covers carry and removal from search. |
| 02b R3-M-8 | Verified | §§3.7a, 5 and 6.19 ll. 341, 534–535, 857–861 record the approved amount and clear it on close, reopen or a due increase above it. #87/#92 ll. 1062, 1067 check stale approval. |
| 03b R3-B-1 | Verified | §§3.4, 6.15 ll. 266–267, 604 and #74/#110/#116 ll. 779, 825, 831 retain pickup and boost and separate the time gate from cooking readiness across points. |
| 03b R3-B-2 | Verified | §§3.4, 4.3 ll. 274, 419 and tests ll. 828–829 require separate order approval and the 02b transaction check. |
| 03b R3-B-3 | **Not fixed (BLOCKER)** | §3.5 ll. 292–298, 315–317 closes the new order-level alert on incompleteness. However, a point raise still targets the placer and §6.21 ll. 623–642, 664 retains raised-target repeats for per-point alerts. If the placer works from the counter, an unaffected point’s surviving Ready can still ring there on a partial bag. Gate the takeaway/parking counter recipient paths, including raised-target delivery to counter devices, through the whole-order alert. Add a two-point Undo case with the placer signed in at a counter and advance through the repeat deadlines. |
| 03b R3-M-1 | Verified | §§3.10, 6.16, 6.22 ll. 372–373, 611, 679–682 move live outstanding and returned work in the hub config transaction, register the recorded move and refresh connected Passes. #132 l. 848 covers source/destination views, refusal and replay. |
| 03b R3-M-2 | Verified | §§4.4, 6.12 ll. 461–469, 600 retain best tied IDs even when the default wins. #127/#131 ll. 843, 847 distinguish explicit ties from the legacy warning exemption. |
| 03b R3-M-3 | Verified | §6.16 l. 607 supplies live station metadata to an existing Pass connection. #126 l. 842 starts with an empty connected Pass and checks its first routed line and a later alternate change. |
| 03b R3-M-4 | Verified | §§3.4, 4.3 ll. 275, 420 require invalidation, fresh tap reads and the final writer check. Tests ll. 827, 834 cover races and cache refresh. |
| 03b R3-M-5 | Verified | §§3.4–3.5, 6.15–6.16 ll. 267, 290, 315, 604, 609 and test l. 826 include other points, unfinished engine lines and station-less time holds. |
| 03b R3-M-6 | Verified | #117/#129 ll. 832, 845 use equally specific points with different station defaults. #117 separates collection without B’s Ready from settlement of B’s existing Ready and served card. |
| 03b R3-M-7 | Verified | #130 l. 846 separates route type edits from edits to real primary and alternate carry rows, uses a hidden unfired non-FIFO line and covers returns and replay. |
| 03b R3-M-8 | Verified | §§3.8, 6.12, 8 ll. 355, 600, 707 require the Kitchen screens Reload path and tolerate missing warnings from an older hub. #131 l. 847 exercises it. |
| 03b R3-M-9 | **Not fixed (MAJOR)** | §3.5 ll. 315–318 defines a whole-order epoch and frozen window, exported by §4.2 `bagReadyAtOf` / `passReadyTimesOf` at l. 403. 02b §§4.1, 4.5 TK-3, 6.16 ll. 423, 485, 789 instead consume `readyAtOf`, which 03b l. 401 still defines as historical maximum point Ready, and add the current window. §10 #67 l. 1042 equates counter time with the later point press, which also fails for completion at a later station-less pickup deadline. Use the R8 pair for both screens, preserve point history separately and test deadline completion, config-window edits and Undo. |
| 03b R3-M-10 | Verified | §§3.4, 4.3 ll. 276, 421 distinguish transport, scope and stage failures. Tests ll. 835, 837 require fresh eligibility for one removed/voided retry and no retry for added/cooking. |
| 01d R3-B-1 | Verified | Header ll. 1–12, §1 l. 243, §10 ll. 2146–2160, 2204 and §12.10 ll. 2379–2390 put 05c-only delivery and payment kinds outside the pilot acceptance and build list. |
| 01d R3-M-1 | Verified | §3.7 l. 862 and §6 batch 3 ll. 1841, 1858 apply current profile to delivery, binding-route sends, catch-up and receipt credit. §10.9i ll. 2142–2143 covers the transition. |
| 01d R3-M-2 | Verified | §§3.5, 6 and 8.1 ll. 761, 1840, 1887 refresh the surviving staff socket after profile change. §10.9i ll. 2135, 2139 checks the live downgrade. |
| 01d R3-M-3 | Verified | §3.3 l. 617, §4.3 l. 1368 and §8.1 l. 1902 use the pending card at step 0. §10.9i ll. 2152–2153 exercises no holder without relying on step ≥2. |
| 01d R3-M-4 | Verified | §4.3 ll. 1367–1369 and §10.9i l. 2154 distinguish own and other pending requests and route the personal result only to the requester. |
| 01d R3-M-5 | Verified | §4.3 l. 1370 and §10.9i l. 2155 count conditional batched close/result work separately from the reused list read. |
| 01b R3-B-1 | Verified | B-5 l. 32 and §4.2 l. 615 defer the persisted enum contract to 01d §5.4. §11 l. 1554 carries the registry/replay dependency. |
| 01b R3-M-1 | Verified | §5.1c l. 902 records landed 0020/0021 and the next contiguous number at merge. |
| 01b R3-M-2 | Verified | §§4.2, 5.1c ll. 614, 965 specify catalogue-first rollout and directory-version recovery after an old hub filters the grant. Test l. 1484 covers the same-version failure and recovery. |
| 01b R3-M-3 | Verified | §5.1c l. 967 requires a full application reload on stale versions and protects unknown grants in the editor. Test l. 1484 covers stale-bundle replacement. |
| 01b R3-M-4 | Verified | B-4 l. 31 and §6.15 l. 1218 distinguish Pass→staff Handover from customer `MarkServed` and assign self-tile filtering to the client. 03b §§3.4–3.5 ll. 274, 305 agree. |
| 01b R3-M-5 | Verified | B-5 l. 32 depends on the 01d pilot slice. 01d §12.10 parks the future permission and payment kinds. |
| 01a R3-B-1 | Verified | §6.9a ll. 1327–1329 distinguishes cloud acceptance from effective archive, moves outstanding/returned work atomically with hub apply, and rejects a missing destination. 03b §6.22 l. 679 and 03a §3.3 l. 727 provide the event and replay fold. |
| 01a R3-M-1 | Verified | PT-5 l. 173, §5.2a l. 1093 and §11 l. 2179 consistently assign the next contiguous cloud number at merge. |
| 01a R3-M-2 | Verified | §6.9a l. 1325 adds the canonical routing set to optimistic-lock hashing, validates under lock, bumps on real writes and preserves no-op semantics. Test l. 2063 covers stale edits. |
| 01a R3-M-3 | Verified | §6.9a l. 1323 preserves the omitted field in the request hash and fills the old cached response in memory. Test l. 2063 covers pre-release replay. |
| 01a R3-M-4 | Verified | §6.9a ll. 1319–1321 and test l. 2063 pin dotted issue paths and the invalid-member index. |
| 01a R3-M-5 | Verified | §§4.4, 6.9 ll. 758, 1313 consume the 03b tied-candidate contract, including cases when the default itself is tied. 03b tests 127/131 pin that case. |
| 00 R3-M-1 | Verified | M97 l. 606 and §7.12 l. 2132 specify independent public admission bounds including guard and unmatched work. §10 #201 l. 2508 covers enforcement. |
| 00 R3-M-2 | Verified | M97 l. 606 and §7.13 ll. 2144, 2147, 2150 define routed/NAT commissioning and require per-client router controls before NAT. Tests ll. 2504, 2508 exercise both. |
| 00 R3-M-3 | Verified | §7.2 ll. 2032–2040 suppresses per-request public logging and classifies terminal outcomes for summaries. Tests ll. 2494, 2509 check request and error traffic. |
| 00 R3-M-4 | Verified | §7.13 ll. 2137–2139 specifies fixed early framework replies with shared headers and socket close for parser and excess pipeline failures. #198 l. 2505 checks both. |
| 00 R3-M-5 | Verified | M99 l. 608, §7.12 ll. 2129–2131 atomically debit the applicable bucket pair only on admission. #185 l. 2492 checks isolation across orders. |
| 00 R3-M-6 | **Not fixed (MAJOR)** | §6.41 ll. 2002, 2020 groups parts using `parent_order_item_id` and #183 l. 2490 exercises distinct deals. The named producer, 02b §4.2 l. 441, still omits the field from `takeawayProgress.lines[]`. The similarly named field at 02b l. 442 belongs to `priceCartDraft`. Add the internal parent key to the progress export and line select within the two existing statements. Check two deals in one order end to end. |
| 00 R3-M-7 | Verified | §7.13 ll. 2146–2147 verifies isolation while disabled, then starts the listener for positive probes before issuing slips. 03c v1.0.16 §§3.11/10 and HPA M98 l. 607 require an active bind before `statusLink` returns a URL. |
| 00 R3-M-8 | **Not fixed (MAJOR)** | M98 l. 607 and §6.41 ll. 2000–2002 require a replayable `tracking_close_cutoff_ms`. 02b §4.2 l. 441 exports only mutable `day_closed_at`. Its migration and writer/folds at §5 l. 600 and §6.19 ll. 855–861 define no cutoff. The existing `OrdersUnbilled` fold clears `day_closed_at` (`apps/hub/src/orders/projection.ts:135–140`). Specify the group cutoff’s storage, recorded-clock fold and export in 02b and retain it through reopen, additions and replay. Exercise the real export in HPA #182. |

## Cross-spec decisions

| Decision | Evidence and result |
|---|---|
| D1 | 03a PK-1/5 and #180/#186/#191, 03b §§3.4/6.15 and #74/#110, 02b §§3.8/4.2 and #67, 05a §3.11 ll. 325–329 and Foundation §4.7 l. 999 agree on retention, scheduling without a pickup floor after Boost, and whole-order readiness. 03a also covers held-slip shrinkage, own FIFO rebooking and v6 engine replay. The customer status display still uses the stored timestamp to select its preparing message (V-01). |
| D2 | 02b §§3.7a/6.4/6.19, 03b §3.4, 05 §§6.12–6.13/6.25 and 01d §4.3 ll. 1367–1370 agree on one order, the due at approval, transactional rechecks and effective invalidation. 02b’s recorded clear IDs preserve replay without recomputing billing. |
| D3 | 05 §§6.2–6.2a ll. 1257–1268 and #60e define the open split balance sum and both numeric cases. 02b TK-15, 03b §3.4 l. 274 and 01d §4.3 ll. 1367–1370 follow that rule. Check-bill paper and results separate gross and remaining payable. |
| D4 | 01d’s pilot slice excludes payment kinds, `when_none` and the provider permission. 02b TK-12 and 01b B-5 depend on the slice. |
| D5 | 01d §5.4 ll. 1674–1678 owns `AlertRaised` v6. 01b §4.2 l. 615 and 02b §6.12a l. 701 point to it. 03b §6.22 ll. 679–682 registers the archive move and complete-bag state events. 05 §6.30 and #91b register `CartCheckBillPrinted` with no live recipient. |
| D6 | README l. 53, 01a PT-5, 01b §5.1c, 02b §5 and 00 HPA §5 use next contiguous at merge. The checked branch ends at cloud 0021 and hub 0027. No active pilot migration reservation found. |
| D7 | 01a §6.9a ll. 1325–1329 owns versioned config and effective archive. 03b §§3.10/6.16/6.22 owns the atomic moves, destination label and refresh. 03a §3.3 l. 727 and §3.12 l. 1122 apply and replay the recorded routes. 02b §§3.2/3.8 and TK-17 preserve ordinary routing and find an active point for a return from an archived point. |
| D8 | The order-level epoch resets in 03b §3.5. A per-point alert can still ring on the counter, and 02b’s history read can disagree with the Pass epoch. See 03b R3-B-3 and R3-M-9. |
| D9 | 02b TK-15/§8 and 05 §6.3a agree on nested input, guards, bill access, successful-print effects and bounds. The closed-target client/test contract still disagrees with 05 (V-02). |

## New findings

### V-01 — MAJOR — Customer status keeps quoting the original pickup after Boost

00 HPA §§6.41, 8.6 ll. 2012, 2019, 2243 send the stored pickup and use it to choose the “Pickup at” preparing message. 02b TK-6 l. 488 directs that page to use effective pickup for the preparing message, and 05a §3.11 l. 329 does so for the board. A boosted order still cooking can therefore show a future pickup on the customer page while the counter and board treat it as being made now. Supply the effective value to the customer page for message selection and keep the stored value wherever historical pickup is displayed. Add a boosted-but-unready status fixture.

### V-02 — MAJOR — The addition check-bill test disagrees about a closed target

02b §8 l. 928 and #73 l. 1048 require a combined document for an addition. 05 §6.3a l. 1286 and #60i l. 1785 require a draft-only document when the referenced bill is closed because Send opens a new bill on the same key. Carry 05’s two cases into 02b’s clause and test. Retain the same nested wire, bill-access check and successful-print effects in each case.

### V-03 — MINOR — The Ready kind’s example duplicates the schema opener

03b §6.21 ll. 636–639 has two consecutive `values_schema: z.object(...` openers. The example cannot be used as written. Remove the duplicate and keep one schema with the optional `counter_screen` field.

### V-04 — MINOR — The takeaway migration case still names the pre-fix column set

02b §5 l. 600 defines eight new columns including `pickup_boosted` and both effective-approval columns. §10 #65 l. 1040 still calls for five and checks only the old list. List all eight in #65 and include replay of Boost and the approval amount/clear in its migration parity fixture.

### V-05 — MINOR — Run-3 provenance points to absent files on the pilot branch

02b l. 134 names `docs/reviews/02b_v1.0.25_hostile_run3.md` as a local path. The current review exists on `lane-02b-tk/review-02b_v1.0.25` and is absent from the verified tree. The 03a status row at l. 11 similarly names its branch-only review. Link the review commits by path as in the source table, or bring the source reviews onto the pilot branch when maintaining the package.

## OWNER questions

None.
