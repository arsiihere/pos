# DL Notification deep links — build board

Plan: `dl-plan.md`. Manual checks: `dl-manual-checks.md`. Spec: `01d_Notifications_Requests_Spec_v1.3.md` §3.13 (APPROVED, owner 2026-11-18 10:05 PKT), now **v1.3.2** (v1.3.1 #249 `b031123c`, v1.3.2 #260 `c903536a`) with 02a v1.1.7, 02b v1.0.15, 03a v1.2.5, 03b v1.0.9, 04 v1.0.6. Review: `docs/reviews/dl-deeplinks-hostile-review.md`. Integration branch: `module-deeplinks` (cut from `main` `049f6ce`; spec set merged `af8fddd5`). Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-18 (Z1): saare 23 build tasks (+ h4b) merged. Acceptance map neeche: 01d tests 69–99 aur 02b #52 sab ke test hain, #71 ka kuch hissa aur "KDS par kabhi nahi" ka test → h5 (in progress); Android tap (G-2) build nahi hua. t1 (e2e) abhi chal raha hai; phir Z3 PR aur aap ke Z2 manual checks.
> - 2026-11-18: plan ready (PR into `module-deeplinks`). 24 build tasks: H 4, C 19 (Cs 12 + Cp 7), T 1; plus Z1–Z3. Sab pending. 4 gaps (G-1–G-4), har ek ka Rec plan mein; owner se sirf G-1 / G-2 ka "haan" chahiye.
> - 2026-11-18 10:05: owner "Theak ha jaise tm kaho" → DL Q-3 (a), Back chip, seen on every tap; spec set APPROVED (#237 `af8fddd5`).
> - 2026-11-18 09:18: DL Q-1 (a), DL Q-2 (a).
> - 2026-11-18 08:45: new feature asked ("notification par click karo to os jaga le jae aur wo highlight ho"); DL Q-0a (a), DL Q-0b (a).

## Owner rulings on how the build runs

Same as 04 (W-1–W-6, `04-status.md`), for `module-deeplinks`:

| # | Ruling |
|---|---|
| W-1 | `module-deeplinks`: PR required, check `gate` required, rebase merge only, no force push. |
| W-2 | The integrator merges green, reviewed PRs into `module-deeplinks`. Stacked: top PR merged, the lower ones closed with a comment. |
| W-3 | The integrator merges green docs PRs. `module-deeplinks` → `main` is the owner's (merge commit); the integrator opens the PR (Z3). |
| W-4 | Lanes are background agents from the integrator session, **at most 4 at once** (H, Cs, Cp, then T). |
| W-5 | Repo public: never commit a secret. |
| W-6 | HIGH tasks get two fresh reviewers (lock safety, command flow, permissions, locks / drafts, statement counts). Fix rounds > 2 → STOP. |

## Owner rulings on the spec (DL)

| # | Ruling | When | Where it landed |
|---|---|---|---|
| DL Q-0a | (a) Kinds with no staff-app screen (`station_overload`, `kds_offline`, `printer_problem`, `no_approver`) keep today's tap, no deep link | 2026-11-18 | 01d v1.3 §3.13.1, §12.8; h2 (no `link`), cs6 #78 |
| DL Q-0b | (a) Existing notifications only; "food ready" to waiters is a later feature (DL-F1) | 2026-11-18 | 01d v1.3 §3.13, §12.4, §12.8; plan "Do not build" |
| DL Q-1 | (a) A request the viewer can answer: open the place, glow it, then `AnswerSheet` on top; only "the request is closed" stops the sheet (B2); a dine-in slip answers in its LateCard | 2026-11-18 09:18 PKT | 01d v1.3 §3.13.2 rule 4, §12.8; cs8, cs10 |
| DL Q-2 | (a) Only `ready_to_serve` treats a fully served order as not open; elsewhere served lines and rounds stay reachable, unfold and glow | 2026-11-18 09:18 PKT | 01d v1.3 §3.13.1, §3.13.3, §12.8; cs4, cp4 |
| DL Q-3 | (a) A notice tap (all six notice kinds) glows the place, then `NoticeSheet` on top with all its facts; not open or uncheckable → the card over the current screen, no toast ("Theak ha jaise tm kaho") | 2026-11-18 10:05 PKT | 01d v1.3 §3.13.2 rule 5, §12.8; cs9 |
| DL-K1 | Kiosk "Back" chip after a deep-link navigation: accepted (one level, `alerts.back`) | 2026-11-18 10:05 PKT | 01d v1.3 §3.13.2 rule 6, §12.8; cs11 |
| DL-S1 | Seen on every tap, also a "no longer open" tap (integrator ruling, confirmed by the owner) | 2026-11-18 (confirmed 10:05 PKT) | 01d v1.3 §3.13.2 rule 3, §12.8; cs6, cs7 |
| DL Q-A | (a) "A dialog is open" (rule 6) means a popup over the screen; `TableSheet` and `OrderView` are route screens (`data-route-sheet`) and a banner Open deep-links from them | 2026-11-18 13:39 PKT | 01d v1.3.2 §3.13.2 rule 6, §12.8, test 99; cs11 (#257) |
| DL Q-B | (a) Leaving `OrderScreen` through a deep link follows 02a's release on unmount: lock released, draft kept, lock taken again on return | 2026-11-18 13:39 PKT | 01d v1.3.2 §3.13.2 rule 6, §12.8, test 86 (b); cs11 (#257) |

## Gaps (plan "Gaps found") — owner to confirm the Rec

| # | Gap | Rec | State |
|---|---|---|---|
| G-1 | No "opened set" exists; a repeated tap after the 250 ms flush re-sends `MarkAlertsSeen` today | cs7 adds a per-session `seenSent` set; wording fix at the next 01d text bump | built (cs7 #254, test 90); 01d wording fix carried (AD-21) |
| G-2 | 9b (Android notification tap) is not built | cs12 builds the page half; native intent → 01d-tablet-plan | page half built (cs12 #264, test 91); Android half **not built**, carried (AD-21); owned by `01d-tablet-plan.md` T7 |
| G-3 | `orderView` `{ kind: 'missing' }` not named by §3.13.3 | read as "cannot check" | built (cs4 #246; asserted in test 81) |
| G-4 | Archived primary tile: 01d "skip tile glow" vs 02a "header glows" | build 02a's (header glows) | built (cs5 #247, cp5 #262; test `[01d #79 G-4]`) |

## Lane H — hub

| Task | Title | Needs | Marker | PR | State |
|---|---|---|---|---|---|
| h1 | `target` on every view + `safeLink`; copy kinds' `values.link` schema | cs1 | HIGH | #250 | merged `81ec6d43` |
| h2 | `link` per owning kind (rows 1–13) | h1 | Cross | #251 | merged `a65e03b0` |
| h3 | Copy kinds carry the request's place (`AnswerRequest`, `pinFailed`, `closeMany`) | h1, h2 | HIGH | #252 | merged `b4e6ac9c` |
| h4 | 02b `order-view` `order_type` + current `seating_id` | — | HIGH, Cross | #239 | merged `4d596bed` |
| h4b | 02b #52 follow-up tests: `TableMoved` keeps `seating_id`; no open seating → null (test only) | h4 | — | #248 | merged `4ddb77c0` |

## Lane C — client

| Track | Task | Title | Needs | Marker | PR | State |
|---|---|---|---|---|---|---|
| Cs | cs1 | `AlertLinkTargetSchema` + view `target` (optional, unknown → null) | — | Shared | #241 | merged `ce9f8329` |
| Cs | cs2 | Texts EN / UR + `urdu-todo.md` | — | — | #242 | merged `a5c706ac` |
| Cs | cs3 | Router `focus` params + phone tabs | — | — | #244 | merged `8e4819e9` |
| Cs | cs4 | Open check: orders, zones, request state | h4, cs1 | — | #246 | merged `72b90ae2` |
| Cs | cs5 | Open check: `table` (M1 merge) + slip first open order (m5) | cs4 | — | #247 | merged `6b55543d` |
| Cs | cs6 | Per-kind tap handler on Inbox, banner, `CallCard`, Requests | cs3, cs5, cp2 | HIGH | #253 closed; merged through top PR **#257** | merged `1c2d1b89` (in #257) |
| Cs | cs7 | Seen once per alert (DL-S1, G-1) | cs6 | HIGH | #254 | merged `870632da` |
| Cs | cs8 | `AnswerSheet` on top (DL Q-1) + B2 | cs6 | HIGH | #255 closed; merged through top PR **#257** | merged `faf54b78` (in #257) |
| Cs | cs9 | `NoticeSheet` on top (DL Q-3) | cs8 | HIGH | #256 closed; merged through top PR **#257** | merged `614a46f3` (in #257) |
| Cs | cs10 | Slip: dine-in LateCard, takeaway `AnswerSheet` (M3) | cs8, cp4, cp6 | HIGH | #263 | merged `40170968` |
| Cs | cs11 | Unfinished work + kiosk Back chip (M5, DL-K1) | cs6, cs2 | HIGH | #257 (top of the cs6 → cs8 → cs9 → cs11 stack) | merged `e5102d77` |
| Cs | cs12 | 9b focus kept through sign-in (page half, G-2) + `dropHandover` on sign-out | cp7 | — | #264 | merged `4f1542c7` |
| Cp | cp1 | Glow tokens, keyframe, reduced motion | — | Shared | #240 | merged `eac45f4c` |
| Cp | cp2 | Scroll / glow helper + live region | cp1 | — | #245 | merged `17020f11` |
| Cp | cp3 | Data attributes + `Round.forceOpen` | — | Cross | #243 | merged `eff0a0cc` |
| Cp | cp4 | Table-sheet places + auto-unfold | cp2, cp3, cs3 | — | #258 | merged `e38c45d7` |
| Cp | cp5 | Map places per device (floor, tile beside panel, header) | cp2, cp3, cs3, cs8, cp7 | — | #262 | merged `daa1f284` |
| Cp | cp6 | `OrderView` / zone places; reads per tap | cp3, cs6 | — | #259 | merged `48616aee` |
| Cp | cp7 | Pass and Inbox places | cp2, cs3, cs8 | Cross | #261 | merged `008fd446` |

Stack note (W-2): #257 (cs11) was the top of the stack cs6 #253 → cs8 #255 → cs9 #256 → cs11 #257. It was rebase-merged into `module-deeplinks`, landing four commits (`1c2d1b89` cs6, `faf54b78` cs8, `614a46f3` cs9, `e5102d77` cs11); #253, #255 and #256 were closed with a comment. cs7 #254 was rebased onto that and merged on its own.

Spec PRs on this branch: #237 `af8fddd5` (v1.3 set), #238 `2944beef` (plan), #249 `b031123c` (01d v1.3.1), #260 `c903536a` (01d v1.3.2).

## Lane T — tests

| Task | Title | Needs | PR | State |
|---|---|---|---|---|
| t1 | E2E smoke `apps/client/e2e/dl-deeplinks.spec.ts` (not in the gate) | all H and C | — | in progress (no PR yet) |

## Close

| # | What | Needs | State |
|---|---|---|---|
| Z1 | Acceptance map (below) filled with green test names | all build tasks | this PR |
| Z2 | Owner manual checks `dl-manual-checks.md` 1–16 (tablet landscape + portrait, phone, kiosk, Pass) | Z1 | pending (owner) |
| Z3 | PR `module-deeplinks` → `main`, **owner merges (merge commit)** | Z1 | pending (owner) |

## AD rows (as-built decisions)

| # | Decision | Task | Approved |
|---|---|---|---|
| AD-1 | **G-1:** there is no store "opened set". cs7 adds a per-session `seenSent` set beside `markSeen` (cleared on sign-in, sign-out, unpair); a repeated tap navigates and glows again with no second `MarkAlertsSeen`. 01d §3.13.2 rule 3 still says "the store's `opened` set, as today": wording fix carried (AD-21) | cs7 #254 | integrator (plan G-1) |
| AD-2 | **G-2:** only the page half of 9b is built (`#/inbox?focus=alert:<id>` kept through sign-in). The Android notification intent is not built; it belongs to the 01d-tablet-plan notification task | cs12 #264 | integrator (plan G-2) |
| AD-3 | **G-3:** the client `orderView` `{ kind: 'missing' }` (hub without the route) is read as "cannot check" | cs4 #246 | integrator (plan G-3) |
| AD-4 | **G-4:** an archived primary tile: the sheet header glows and the tile glow is skipped (02a v1.1.7 §8, which also meets 01d "skip tile glow") | cs5 #247, cp5 #262 | integrator (plan G-4) |
| AD-5 | **h4:** a dine-in order whose seating is not open gives `seating_id: null` (no open `seating_orders` row); the client treats it as not open. Not in 02b §6.18a's text yet: goes in at the next 02b §6.18a text bump. Tested by h4b `[02b #52] dine-in with no open seating → seating_id null` | h4 #239, h4b #248 | integrator, carried to 02b |
| AD-6 | **01d v1.3.1:** the reduced-motion ring is an `outline` (2px solid `--glow-brand-ring`, offset 2px), not `box-shadow`, because `pulse-02.css` / `pulse-03.css` set `box-shadow` on `.rnd`, `.ol`, `.pc`, `.lc` later in the cascade. The `.pos-glow` CSS lives in `staff-02-additions.css`, because the staff entry (`apps/client/src/app/ui-kit-staff.ts`) never loads `bundle.css`. Test 98 added | cp1 #240, spec #249 | integrator (owner delegated) |
| AD-7 | **01d v1.3.2:** DL Q-A (a) (route screens `TableSheet` / `OrderView` carry `data-route-sheet` and do not block a banner Open; rule 6 checks `[aria-modal="true"]:not([data-route-sheet])`), DL Q-B (a) (leaving `OrderScreen` releases the lock per 02a, draft kept), and the `#/held` wording (a dine-in draft is not listed in `#/held`; it comes back from the table sheet). Tests 86 (rewritten) and 99 | cs11 #257, spec #260 | owner 2026-11-18 13:39 |
| AD-8 | **The tap owns the glow:** places (table sheet, map, OrderView, zones, Pass, Inbox) only expose and unfold the element; the one glow path is the tap's `glowOnArrival` (defer a frame, skip a collapsed element). `OrdersPart` never glows or drops `focus` itself | cs6 #257, cp4 #258, cp7 #261 | integrator ruling (Cs #253 review) |
| AD-9 | **cp6 preload handover:** `apps/client/src/features/staff/orders/preload.ts` one-shot handover of the tap's `order-view` / `zone-stock` body, keyed by `order_id`, applied to an already-mounted screen (`onHandover`), dropped at the first hash change to another route or after `HANDOVER_MS` (4 s), and by `dropHandover()` at every session change. One-line Cross edit in `deeplink-tap.ts` (`handOver(...)`) | cp6 #259 (+ cs12 #264 for sign-out) | integrator ruling (a) |
| AD-10 | **cp7 Pass in-place block:** one block in `deeplink-tap.ts` `tapAlert` after rule 1 and the seen step: an `order` target whose `article.pc[data-order]` is rendered and shown on `#/pass` glows in place (no `order-view`, no navigation). A row the viewer can answer also gets `AnswerSheet` on top (DL Q-1 (a) on the Pass); a lock-only row gets no sheet | cp7 #261 | integrator ruling (a) |
| AD-11 | **cp5 `tablePlace` and `shell/layout.ts`:** `tables/map/table-place.ts` picks the `table` place (phone / portrait → header; landscape → tile once its floor is drawn, header if still under the panel after the scroll, archived, or hidden by "Mine" on a loaded map); `staff/shell/layout.ts` is the one matchMedia helper (`PHONE_QUERY`, `PORTRAIT_QUERY`, `bottomSheetLayout()`). One-line Cross edit in `deeplink-tap.ts` `findPlace` `case 'table'`. The scroll-padding rule and its test were dropped (`.zones` never scrolls sideways) | cp5 #262 | integrator ruling (a) |
| AD-12 | **cs4 4th result:** `CheckResult` gains `request_closed` beside `open` / `not_open` / `cannot_check`, the only result that stops `AnswerSheet` (B2); toast as `not_open` | cs4 #246 | integrator (review) |
| AD-13 | **cs5 `no_place`:** an open slip request with no order place left (every order of the group cancelled or billed, or a dine-in order with no seating / tile) is open by itself (spec wins) but has nowhere to route → `no_place` → today's tap (rule 1: the sheet) | cs5 #247 | integrator (review) |
| AD-14 | **cs8:** an answerable or notice tap waits at most 3 s for its check (`CHECK_TIMEOUT_MS = 3_000`), then opens the sheet over the current screen (B2). `sheetSeq` was removed: the tap generation guard (`tapGen`) already stops a stale tap opening a sheet over a newer one | cs8 #257 | integrator (review 2) |
| AD-15 | **cs10 `ownRoute`:** the deep link's own navigation (and its `consumeFocus`) does not make its tap stale, so a dine-in slip with no LateCard still gets `AnswerSheet`. Same-read assumption: the round and its LateCard come from the same `seating-orders` read in the same render, so a round on screen with no LateCard a frame later means none will come | cs10 #263 | integrator (review 2) |
| AD-16 | **cs12:** sign-in keeps only the 9b focus (`#/inbox?focus=alert:<id>`); any other landing hash is replaced as before. Focus (and the handover, `seenSent`, the tap generation) is stripped on sign-out and unpair, so it never leaks to the next person | cs12 #264 | integrator (review) |
| AD-17 | **h3:** the hub `ResultOf.link: AlertLinkTarget \| null` is required (no caller can forget it); `storedRequestLink(kind, values_json)` is the guard. Test 72 (c) "a bill transaction" uses **CleanTable** (no 05 bill command on the hub yet), and the fake request kind is a swapped `table_handover` registration (MergeTables / CleanTable close by `byDedupeKey('table_handover', …)`) | h3 #252 | integrator (review) |
| AD-18 | **cs6 tap generation guard:** a tap is current until the next tap, a session change or a route change; a stale tap's late check does nothing (no glow, no sheet, no toast), seen still sent once | cs6 #257 | integrator (review B) |
| AD-19 | **cs7:** an id joins `seenSent` when it is queued and is taken out again if `MarkAlertsSeen` fails (same session), so a failed send is retried by the next tap | cs7 #254 | integrator (review B) |
| AD-20 | **cs11:** a banner Open is held back only by a popup (`[aria-modal="true"]:not([data-route-sheet])`); the kiosk Back chip is not shown when the tap lands on the screen already open | cs11 #257 | owner DL Q-A (a) |
| AD-21 | **Follow-ups not built (carried):** h1 NITs — `alert-sockets` `StrictTarget` typing, the `my-requests` lock-only helper, rename `targetOf` → `storedRequestLink` use; 01d §3.13.2 rule 3 "opened set" wording (G-1, next 01d text bump); 02b §6.18a `seating_id` null text (AD-5); the Android notification tap (G-2, 01d-tablet-plan); Pass signed-out tablet wording (01d §3.13.5 devices table) | — | integrator |

## Acceptance map (Z1, 01d v1.3.2 §10.9d–f, 02b v1.0.15 §6.18a)

Checked on `module-deeplinks` @ `40170968` with `git grep -n "\[01d #" -- apps packages` and `git grep -n "\[02b #52]"`. Paths: `alerts/` = `apps/client/src/features/alerts/`, `staff/` = `apps/client/src/features/staff/`, `pass/` = `apps/client/src/features/pass/`, `hub/` = `apps/hub/test/`. Every test named here passed in the Z1 run (totals at the end).

### Tests 69–99 and 02b #52

| Test | What | Test file:line — name | Task | State |
|---|---|---|---|---|
| 69 | per-kind `link`, guard | `hub/alerts/deeplink-kinds.int.test.ts:90` "each of the 19 kinds: its values_schema fixture gives exactly its §3.13.1 target; null for 8, 12, 13, 18, 19"; `:99` "slip_warning takes order_ids[0]"; `:103` "a link that throws, values that fail to parse and a result outside the schema each give target null; the view is still built"; `:199` "stored values a link cannot use … nothing is logged" | h2 | green |
| 70 | `target` on every view; M2 wire | `hub/alerts/deeplink-views.int.test.ts:239` (a) "a linked kind: lock frame, card frame, alerts_open, catch-up, alerts-inbox and requests-to-answer rows carry the same target"; `:267` (a) KDS station socket; `:293` (b) "the strict lock pick accepts target and still refuses card, details, answers, needs_pin, silent, raised_device_id"; `:279`, `:307` (c); `:318` (d) (e); `packages/events/src/alerts.test.ts:656` "[01d #70 (d)/(e)] a WsServerMessage alert frame with an unknown or malformed target is kept"; client half of (d) (banner, sound, inbox row) in `alerts/store.test.ts:368` (#96) | h1, cs1 | green |
| 71 | statement counts unchanged | `hub/alerts/deeplink-copy.int.test.ts:287` "statement counts are the same with and without a link (and with a throwing one): raise, AnswerRequest, closeMany, alerts-inbox, requests-to-answer" (absolute totals pinned) | h3 | → h5 (in progress) |
| 72 | copy kinds; throwing `link` at raise (M4) | `hub/alerts/deeplink-copy.int.test.ts:64` (a) approve; `:80` (a) reject + `:also`; `:93` (a) obsolete through closeMany; `:102` (a) answered_on_requester_device; `:114` (a) pin_use_failed; `:237` real table_handover control; `:247` (b) (c) "AnswerRequest commits … values.link null; no VALIDATION_FAILED"; `:258` (b) (c) "a MergeTables and a CleanTable that closeMany the request commit" | h3 | green (bill = CleanTable, AD-17) |
| 73 | frozen and old rows | `hub/alerts/deeplink-kinds.int.test.ts:212` (a); `:223` (b); `:232` (c); `:245` (d) | h2 | green |
| 74 | tap, open target | `alerts/deeplink-tap.test.tsx:161` "open: navigate to the §3.13.5 hash, scroll the place, glow it for --motion-glow (1500ms), "Opened …", seen once, focus dropped by replaceState"; `:473` Inbox card; `:723` "a banner Open and the CallCard go through the same rule" | cs6 | green |
| 75 | tap, not open | `alerts/deeplink-tap.test.tsx:239` "not open (404, cancelled, billed, line missing, live_units 0, ready_to_serve all served, table unresolved, zone item missing, closed request): toast, route unchanged, no sheet, seen"; `:268` "DL Q-2 (a): a served comp / void_approval line is open" | cs6 | green |
| 76 | folded round | `staff/orders/table-view/orders-part-focus.test.tsx:286` served_card; `:303` comp line; `:347` "the tap owns the glow"; `alerts/deeplink-tap.test.tsx:571`, `:641` (real tap sequence) | cp4, cs6 | green |
| 77 | reduced motion, tokens | `alerts/glow.test.tsx:44` "reduced motion: no smooth scroll, the class (static ring in CSS) goes after --motion-glow; the tokens exist for both themes"; the outline ring itself under the real CSS: #98 | cp2, cp1 | green |
| 78 | `target: null` keeps today's tap | `alerts/deeplink-tap.test.tsx:294` "target null keeps today's tap: station_overload, kds_offline, printer_problem, no_approver, test_alert, a pre-v1.3 request_result" | cs6 | green |
| 79 | devices | `staff/tables/map/map-focus.test.tsx:349` phone line in bottom sheet; `:227` phone header + Tables tab; `:185` landscape tile beside panel; `:202` still covered → header; `:215` portrait; `:265`, `:283`, `:316` floor (m7); `:296` kiosk lock-only void, no AnswerSheet; `:253` merged → primary tile; `:240` archived (G-4); `:335` "Mine" filter. Pass half: `pass/pass-inbox-focus.test.tsx:136` (#95) | cp5, cp7 | green |
| 80 | answerable request (DL Q-1) | `alerts/deeplink-answer.test.tsx:117` (a) (b); `:128` (c); `:285` requests row | cs8 | green |
| 81 | B2, sheet never lost | `alerts/deeplink-answer.test.tsx:135` "403 outside_scope, 5xx, NETWORK, not open (cancelled), { kind: missing } → AnswerSheet over the current screen; no navigation, glow or toast"; `:297` "… and the answer is sent" | cs8 | green |
| 82 | B1, current seating | `alerts/deeplink-check.test.ts:166` merged / split / takeaway; `:193` "never reads the order's table_key"; hub side 02b #52 | cs4 | green |
| 83 | B3, notices keep facts (DL Q-3) | `alerts/deeplink-notice.test.tsx:274` the five notices; `:128` full void + failed order-view; `:332` failed order-view over the Inbox | cs9 | green |
| 84 | M1, merge | `alerts/deeplink-check.test.ts:345` "S4 absorbs S5 → S4's sheet …; the same for an open table_handover; a party seated after the call → not open" | cs5 | green |
| 85 | M3, slip | `alerts/deeplink-slip.test.tsx:138` (a) (c); `:316` (a); `:329`, `:341` (c); `:206`, `:367` (b) | cs10 | green |
| 86 | M5, unfinished work (v1.3.2) | `alerts/deeplink-unsaved.test.tsx:121` (a); `:290` (a) in the shell; `alerts/deeplink-route-sheet.test.tsx:263` (b) "from the real OrderScreen (real useTableLock): navigate, ReleaseTableLock once …, the draft kept; reopening … brings the cart back; #/held does not list it"; `alerts/deeplink-unsaved.test.tsx:265` (c) kiosk Back chip | cs11 | green |
| 87 | m3, zone archived | `alerts/deeplink-check.test.ts:306` | cs4 | green |
| 88 | m4, partial void | `alerts/deeplink-notice.test.tsx:149` | cs9 | green |
| 89 | m5, slip first order cancelled | `alerts/deeplink-check.test.ts:405` | cs5 | green |
| 90 | m10, repeated tap | `alerts/deeplink-tap.test.tsx:666` | cs7 | green |
| 91 | 9b tap while signed out | `alerts/deeplink-signin.test.tsx:127` page half; `:146` card absent | cs12 | green (page half); **Android half not built (G-2)** |
| 92 | m1, phone tabs | `staff/shell/routes.test.tsx:187` | cs3 | green |
| 93 | UR text | `apps/client/src/i18n/i18n.test.ts:400` | cs2 | green |
| 94 | m11, focus only where valid | `staff/shell/routes.test.tsx:149`; `staff/StaffApp.focus-routes.test.tsx:101` (pages still mount) | cs3 | green |
| 95 | m12, Pass | `pass/pass-inbox-focus.test.tsx:319` signed out, nothing tappable; `:136` signed-in lock-only glows in place; `:156`, `:186`, `:202` | cp7 | green |
| 96 | M2, client store | `alerts/store.test.ts:368` "an alert whose frame carried an unknown target type re-notifies once on reconnect and opens its sheet with today's tap" | cs1 | green |
| 97 | m3, reads per tap | `staff/orders/reads-per-tap.test.tsx:194` takeaway; `:241` zone; `:264` dine-in; `:226`, `:287`, `:324`, `:344`, `:362`, `:373`, `:396`, `:421`, `:451` handover edges | cp6 | green |
| 98 | ring under full staff CSS (v1.3.1) | `apps/client/test/glow-staff-css.test.ts:79` "the staff entry loads no bundle.css, and the .pos-glow rules are in its last layer"; `:87` "every target type with pos-glow: outline 2px solid …, offset 2px, no animation" | cp1 | green |
| 99 | banner from a route screen (v1.3.2) | `alerts/deeplink-route-sheet.test.tsx:203` "TableSheet (loading, then loaded) and OrderView carry data-route-sheet; a banner Open deep-links from each; a popup over TableSheet holds it back" | cs11 | green |
| 02b #52 | `order-view` `order_type` + current `seating_id` | `hub/orders/order-view.int.test.ts:197` dine-in; `:206` TablesMerged; `:224` SeatingSplit; `:240` TableMoved; `:249` no open seating → null (AD-5); `:273` takeaway / parking; `:281` 3 statements, 403 / 404; `:310` seating-orders keys unchanged (R-1) | h4, h4b | green |

### Story acceptance (`docs/stories/deeplinks-refined.md`)

| Story AC | Tests | Manual | State |
|---|---|---|---|
| 1. Tap opens the place, scrolls, 2 s glow (static ring with reduced motion) | 74, 76, 77, 79, 82, 84, 85, 97, 98 | manual (dl-manual-checks) 1, 2, 3, 6, 7, 8, 13 | green |
| 2. Not open → "This item is no longer open.", screen unchanged; requests and notices still open their sheet | 75, 80 (c), 81, 83, 87, 88, 89 | manual (dl-manual-checks) 4, 5 | green |
| 3. `station_overload`, `kds_offline`, `printer_problem`, `no_approver`, `test_alert` as today | 69, 78 | manual (dl-manual-checks) 15 | green |
| 4. Every tap marks the alert seen | 74, 75, 78, 90, 95 (seen once) | — | green |
| 5. Tablet (landscape, portrait), phone, kiosk; never the KDS | 79, 86 (c), 91, 92, 95, 99 | manual (dl-manual-checks) 1, 9, 11, 12, 16 | tablet / phone / kiosk green; "never the KDS" → h5 (in progress) |
| Wire / hub (no AC; §3.13.1) | 69, 70, 71, 72, 73, 96, 02b #52 | — | green, except 71 → h5 (in progress) |
| Routes / texts (§3.13.5, §3.13.6) | 92, 93, 94 | manual (dl-manual-checks) 16 (Urdu) | green |
| Android notification tap (9b native intent) | — | — | **not built (G-2)** |
| Offline behaviour on real devices | 81 (NETWORK) | manual (dl-manual-checks) 14 | green in the gate; real-device check is Z2 |

### Z1 run (2026-11-18, `TMPDIR=/dev/shm pnpm vitest run`, no `test:perf`)

| Scope | Files | Tests |
|---|---|---|
| `apps/client` | 195 passed | 1 658 passed (first run in a fresh worktree: `test/build-output.test.ts` 5 failed with `ENOENT` because `apps/client/dist` was not built; after `pnpm --filter @pos/client build` that file is 5 / 5) |
| `apps/hub/test/{alerts,orders,tables,voids,kds,engine-host}` + `packages/events` | 121 passed, 1 skipped | 1 692 passed, 1 skipped |
