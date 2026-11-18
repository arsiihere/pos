# Hostile review: notification deep links (01d v1.3 §3.13)

- **PR:** #237, branch `lane-P0/dl-spec` @ `f59be6ad`, base `module-deeplinks` @ `049f6ce0`.
- **Files reviewed:** `docs/specs/01d_Notifications_Requests_Spec_v1.3.md` (§3.5 note, §3.10 note, §3.13, §4.6, §5.4, §6 batch 3, §8.1, §8.2, §10.9d, §12.4, §12.8); the pointer bumps 02a v1.1.7, 02b v1.0.15, 03a v1.2.5, 03b v1.0.9, 04 v1.0.6; `docs/specs/README.md`; `docs/OPEN-QUESTIONS.md` §11; `docs/stories/dl-deeplinks.md`.
- **Code checked against:** `apps/hub/src`, `apps/client/src`, `packages/events`, `packages/ui-kit` on the PR branch. The PR changes no code, so this is the code at `049f6ce`.
- **Reviewer:** a fresh session with no stake in the spec.
- **Line numbers:** `01d:N` is a line of `01d_Notifications_Requests_Spec_v1.3.md` on `f59be6ad`. Code paths are relative to the repo root.

## Verdict: CHANGES

| Severity | Count |
|---|---|
| BLOCKER | 3 |
| MAJOR | 6 |
| MINOR | 13 |
| NIT | 5 |

Most of the hub-side claims are true. Every id the per-kind table names is in the stored values, and the view builders already select `values_json`. The problems are on the client side:

- The open check uses a read that does not return what the check needs.
- A check that fails can hide the only way to answer an urgent request.
- Taps on personal security notices and on request results no longer open the facts the person needs.

---

## What was verified true (no finding)

| Claim | Evidence |
|---|---|
| `void_approval` values carry `order_id`, `order_item_id` | `apps/hub/src/voids/kind.ts:22-35` `VoidValues` |
| `comp` values carry `order_id`, `order_item_id` | `apps/hub/src/orders/commands/comp-line.ts:44-58` |
| `table_handover` values carry `seating_id` | `apps/hub/src/tables/kinds.ts:11-15` |
| `call_waiter` values carry `seating_id` (the seating found at raise, not the payload's) | `apps/hub/src/tables/call-waiter-kind.ts:7-12`, `tables/commands/call-waiter.ts:51-54` |
| zone kinds carry `zone_id`, `item_id` | `apps/hub/src/orders/zone-kinds.ts:9-15`, `orders/zone-alerts.ts:34` |
| `slip_warning` `order_ids[0]` = subject (oldest order) | `apps/hub/src/engine-host/fires-alerts-tick.ts:252, :280` |
| `engine_line_dropped` values carry `order_id`, `order_item_id` | `apps/hub/src/engine-host/kinds.ts:207` |
| `ready_to_serve` / `served_card` values carry `order_id` (also on `ready_retarget` re-raise) | `apps/hub/src/kds/kinds.ts:13-19, :51`; `kds/commands/ready.ts:173`; `kds/ticks.ts:73`; `kds/commands/handover.ts:199` |
| Old rows: owning-kind ids were in values from each kind's first version | same files; no values schema dropped a field |
| `values_json` is written only by the `AlertRaised` insert | `apps/hub/src/projections/alerts.ts:218` (no UPDATE of `values_json` anywhere) |
| Every view builder already selects `values_json` | `alerts/ws-frames.ts:141`, `alerts/alert-sockets.ts:103`, `alerts/catch-up.ts:56`, `alerts/queries/alerts-inbox.ts:53`, `alerts/queries/requests-to-answer.ts:29`, `alerts/queries/my-requests.ts:25`; all go through `lockView` (`ws-frames.ts:348`) |
| `AnswerRequest` reads `values_json` in its request read | `alerts/commands/request-row.ts:35-39` |
| `closeMany` needs one added column in its existing SELECT | `alerts/raise.ts:452-456` (today it has no `values_json`) |
| Foundation §6.5 defines no frame bodies (types and transport only), so no foundation bump | `docs/specs/00_Foundation_Spec_v1.13.md` §6.5 "Alert frames (01d) …" paragraph |
| No merged spec file edited; each new version file has a changelog row and "Changed by 01d v1.3 (L-4x)" markers; README rows point at the new files; 03c unchanged | `git diff --stat module-deeplinks...lane-P0/dl-spec`; per-file diffs vs v1.1.6 / v1.0.14 / v1.2.4 / v1.0.8 / v1.0.5 |
| "DRAFT, awaiting owner approval" is right for 01d v1.3 and the five pointer bumps | the owner has ruled DL Q-1 / Q-2 but has not approved the text |

---

## BLOCKER

### B1. The open check cannot work out the place of an `order` / `order_line` target, and the rule it states is wrong after a merge or split

- **Where:** 01d:847-848 (the "Then" column: "`order_type = 'dine_in'`: `seating_id` = `table_key` after `dine_in:`"), 01d:780 ("The seating, order type and current table of an order come from the existing `order-view` read").
- **Code:**
  - `GET /queries/order-view` returns `toSeatingOrder(...)`: `apps/hub/src/orders/queries/order-view.ts:56`, `orders/queries/seating-orders.ts:102-126`. The `SeatingOrder` shape (`seating-orders.ts:50-63`) has **no `order_type`, no `table_key` and no seating**. The `ORDER` statement reads them (`order-view.ts:22`), but `toSeatingOrder` drops them.
  - Even if `table_key` were sent, it is wrong. `orders.table_key` is written at placement and never updated. `TablesMerged` and `SeatingSplit` move orders by rewriting `seating_orders.seating_id` (`apps/hub/src/tables/projection.ts:293, :324`; payload `order_ids` in `tables/commands/merge-tables.ts:152-163`, `split-seating.ts:94, :151`). After a merge, an order's `table_key` names the absorbed seating, which is on no tile. After a split that moves the order, `table_key` names the old seating, which still exists, so the tap opens the **wrong table**.
- **Why it matters:** every `order_line` and `order` target fails. That is kinds 1, 2, 7, 9, 10, 11 and the copy kinds that carry their targets. The client cannot tell dine-in from takeaway, so it cannot choose between the table sheet and `#/orders/<id>`. If an implementer "fixes" this with `table_key`, the tap silently lands on the wrong table or shows "no longer open" for food that is on a live table.
- **Fix:**
  - Add a 02b row (in v1.0.15, which is already open) giving the `order-view` body two fields: **`order_type`** and the **current `seating_id`** (dine-in only, else null). Take the seating from `LEFT JOIN seating_orders so ON so.order_id = o.order_id` in the **same** `ORDER` statement, so it costs 0 extra statements.
  - Rewrite 01d:847 to use that field, never `table_key`.
  - Correct 01d:780.
  - Add tests: an order moved by `TablesMerged` and one moved by `SeatingSplit` each open the seating they are in now (see M6).

### B2. When the open check fails, an approver can no longer answer the request

- **Where:** 01d:836 (cannot check → "stays and shows the existing text … never navigates"), 01d:838 (rule 4: `AnswerSheet` opens "**After** step 2 navigates and starts the glow"; "If the request is not open … no AnswerSheet").
- **Code:** for takeaway or parking, `order-view` is scoped by the caller's **`mark-served`** right on the order's `placed_by`. It returns `403 PERMISSION_DENIED { reason: 'outside_scope' }` to anyone whose `mark-served` scope does not cover the order (`apps/hub/src/orders/queries/order-view.ts:34-42`, `orderCovered`). An approver with `approve-void` or `approve-comp` but `mark-served` limited to `own_tables` / `my_floors`, or with no `mark-served`, gets 403. A `5xx`, or the socket going down between the frame and the tap, has the same effect.
- **Why it matters:** today the tap always opens `AnswerSheet` (`StaffApp.tsx:663-684`). Under v1.3, the same approver sees "outside scope" and has **no other path** to Approve / Reject. The Inbox card and the `#/requests` row both route through §3.13.2. `void_approval` is urgent, and an open void blocks day close (`409 DAY_CLOSE_BLOCKED`, 04 A-1). This is a regression on the most safety-critical flow, and DL Q-1 (a) did not ask for it ("show place, glow, **then** the answer sheet").
- **Fix:** for a view the viewer can answer (`answers` / `can_answer`), only "the request is closed" may suppress `AnswerSheet`. For any other check result (not open, 403, `NETWORK`, `5xx`), open `AnswerSheet` over the current screen, as today, and do not navigate. State this in rule 4 and test it (M6).

### B3. Personal security notices and request results lose their content when tapped

- **Where:** 01d:832 (only `target: null` opens `NoticeSheet`), 01d:803-806 (copy kinds 14-17 get the request's target), 01d:865 (approved void → toast only), 01d:806 (`pin_use_failed`: "the request is closed" applies → toast).
- **Code:** `NoticeSheet` (`apps/client/src/features/alerts/AnswerSheet.tsx:443-510`) is the only place that shows:
  - the device name and time of an in-person answer or a failed PIN use, and the **"Not you?"** warning for `answered_on_requester_device` / `pin_use_failed` (`:450`, `:497-502`);
  - the closer's note on a `request_result` (`details.reason`, set by `requestResultInput`, `apps/hub/src/alerts/raise.ts:397-422`).
- **Why it matters:**
  - Under v1.3 these taps navigate or toast instead. `pin_use_failed` exists so a person learns that someone tried to use their PIN, and from which device (01d §3.3 rule 4 (d)). After the request closes, its tap shows "This item is no longer open." and the facts are never shown.
  - A rejected void or comp's reason ("why did the manager say no?") is no longer reachable.
  - An approved void shows only a toast.
  - The owner ruled Q-1 (a) for **requests the viewer can answer**. He did not rule that notices drop their facts.
- **Fix:** ask the owner (new **DL Q-3**). Recommend applying Q-1 (a)'s pattern to the copy kinds: navigate and glow, then `NoticeSheet` on top. When the place is not open or cannot be checked, open `NoticeSheet` over the current screen instead of the toast. At minimum, `answered_on_requester_device` and `pin_use_failed` should keep today's tap (`link` absent). Add tests (M6).

---

## MAJOR

### M1. A merge leaves an open `call_waiter` pointing at an absorbed seating: "no longer open" while the guests are seated

- **Where:** 01d:780 ("after `TableMoved` or a merge the seating's current tile is found in the table map"), 01d:793 (not open when "the seating is on no tile"), 02a v1.1.7 §6.14 pointer.
- **Code:**
  - `MergeTables` absorbs the other seating (`absorbed_seating_id`, `apps/hub/src/tables/commands/merge-tables.ts:158-163`) and moves its tables into `into_seating_id`.
  - It closes only the **handover** alerts (`:175-180`).
  - `call_waiter` is closed only by bill / clean (`tables/commands/bill-clean.ts:107-124`) or its 5-minute auto-close. Its dedupe key is `call_waiter:<old seating>` (`call-waiter.ts:57`).
- **Why it matters:** the claim is false for the absorbed side. A waiter taps "T5 is calling", the table is now part of the merged T4 + T5 seating, and the app says "This item is no longer open." while the call is still open and the guests are waiting.
- **Fix (pick one, then test it as 73 (d)):**
  - Carry the table too, as `table { seating_id, table_id }`. When no tile holds `seating_id`, fall back to the tile with `table_id` that is seated now. The `table_handover` and `call_waiter` values already carry `table_id`.
  - Or add a 02a rule that `MergeTables` closes the absorbed seating's `call_waiter` as `obsolete`. That is a rule change, so it needs owner sign-off.

### M2. `target` breaks forward and backward compatibility on the client

- **Where:** 01d:769-776 (strict discriminated union; "`target: AlertLinkTargetSchema.nullable()` (required on every view)"), test 70 (01d:1688: "`AlertLinkTargetSchema` refuses … unknown `type`s").
- **Code:** the client validates every server frame and **drops the whole frame** when it fails (`apps/client/src/features/alerts/socket.ts:142-143`, `WsServerMessage.safeParse` → `return`). Foundation §6.5: "both ends validate every frame". Every earlier additive view field is `.optional()` (`outcome`, `answers`, `needs_pin`, `silent`, `raised_device_id`; `packages/events/src/alerts.ts:115-131`).
- **Why it matters:**
  - A later target type (the deferred "food ready" kind, or a future `station` target) on a client running an older bundle drops the alert frame: no banner and no sound, including urgent voids. Clients that run an older bundle include the 9b Capacitor app, whose assets are bundled, and a kiosk tab not reloaded after a hub release.
  - In the other direction, a client on v1.3 behind a hub rolled back to v1.2.5 drops every alert, because `target` is required.
  - The cost of a bad deep link is a missing glow. The cost of this schema is a missing alarm.
- **Fix:**
  - On the shared wire schema, make it `target: AlertLinkTargetSchema.nullable().optional().catch(null)` (or `catch` only on the client parse). Keep the strict schema for the hub's own build check, `safeParse` → null.
  - Change test 70 to: the hub never emits an unknown type, **and** a client frame with an unknown `type`, or with no `target`, still parses and gives `target: null`.

### M3. `slip_warning`: a non-dine-in slip cannot be answered, and the glow lands on the wrong element

- **Where:** 01d:796 ("`#/orders/<id>` for a non-dine-in key"), 01d:838 (rule 4 exception: `slip_warning` opens no `AnswerSheet`), 03a v1.2.5 pointer.
- **Code:**
  - `LateCard` is rendered only by the table sheet's `OrdersPart` (`apps/client/src/features/staff/orders/table-view/OrdersPart.tsx:209-215`). `OrderView` (`#/orders/<id>`) has none.
  - In `OrdersPart`, LateCards render **above** the rounds, not inside the round that `focus=order:<order_ids[0]>` glows (`Round.tsx:52`).
- **Why it matters:** the receiver of a takeaway or parking slip taps it, lands on `OrderView` with no LateCard and no `AnswerSheet`, and cannot answer "Send what's ready / Wait". For dine-in, the glow marks the round while the control the person must use sits elsewhere.
- **Fix:**
  - Limit the rule-4 exception to the case where a LateCard is rendered (dine-in). Otherwise open `AnswerSheet`.
  - For dine-in, glow the LateCard (`[data-alerts~="<alert_id>"]`, which exists) instead of the round, and scroll to it.
  - Add both cases to test 80.

### M4. The raise-time `link` call is unguarded and contradicts §3.5

- **Where:**
  - 01d:510: `link` "runs when a view is built, **never at raise**, and a throw gives `null`".
  - The statement-count table: "`raise` of an owning kind: none: `link` is not run at raise".
  - Against those, 01d:726 and 01d:783: the copy kinds call `requestKind.link(request.values)` **at raise**, inside `AnswerRequest` and `closeMany`.
- **Code:**
  - `closeMany` runs inside other modules' command transactions: `MergeTables` (`merge-tables.ts:180`), the comp stale closes (`orders/line-change.ts:39`), `SplitSeating`, bill / clean.
  - The copy kinds' new `values.link` is validated by their `values_schema` at raise (01d §6.1 step 3 → `VALIDATION_FAILED { issue: 'values_invalid' }`).
- **Why it matters:** a `link` that throws, or returns a shape that fails `AlertLinkTargetSchema`, aborts the approval, merge, split or bill that triggered the result. That is a worse failure than the view-time path the spec carefully made null-safe.
- **Fix:**
  - State that the raise-time call is `try { safeParse(link(values)) } catch → null`, so it never throws into the caller.
  - Reword 01d:510 to "runs when a view is built, and for the copy kinds once at raise (guarded)".
  - Add to test 72 a request kind whose `link` throws: the answer commits and `values.link` is null.

### M5. Navigating away from unfinished work is not specified

- **Where:** 01d:830-839, 01d:895 (kiosk: "no browser back … home control … one tap away").
- **Code:**
  - Today the only alert tap that changes route is the zone banner (`Banner.tsx:25, :100`).
  - `OrderScreen` holds a table lock and a `LockBanner` / `keepDraft` (`orders/order-screen/OrderScreen.tsx:573, :587`). Its cart is in IndexedDB (`:73-90`).
  - Sheets (Send dialog, PIN pad, bill, remove / void sheets) are local state.
- **Why it matters:** every banner's **Open** now navigates. A cashier mid-order on the kiosk taps a banner and loses the screen, any open dialog and the lock context. There is no back button, and "home" is not where they were. The spec says nothing about whether an open dialog blocks the tap, whether the table lock is released, or how to return.
- **Fix:** add a rule. Recommended:
  - while a dialog or sheet is open, banners do not navigate (they behave as today);
  - from `OrderScreen` the draft is kept (it already is), and the lock follows 02a's leave-the-screen rule;
  - the kiosk gets a "Back to <previous screen>" chip after a deep link.
  - Add a test.

### M6. Tests 69-80 miss the cases that break

Missing, in order of risk:

1. An order moved by `TablesMerged` and one moved by `SeatingSplit` open the seating they are in now (B1).
2. An approver whose `order-view` returns `403 outside_scope`, `5xx`, or `NETWORK` still gets `AnswerSheet` (B2).
3. `pin_use_failed` / `answered_on_requester_device` / rejected `request_result` taps show the device, time, note and "Not you?" (B3, after DL Q-3).
4. A `call_waiter` on a seating absorbed by a merge (M1).
5. A client frame with an unknown `target.type`, and a frame without `target`, still parse and the alert still banners and sounds (M2).
6. A non-dine-in `slip_warning`; a dine-in slip glows the LateCard (M3).
7. A throwing request-kind `link` at `AnswerRequest` and at `closeMany` (M4).
8. A tap while a dialog is open, and from `OrderScreen` holding a lock (M5).
9. `zone-stock` → `404 ZONE_NOT_FOUND` (archived zone) is "not open" (m3).
10. A partial void approved: the line still has live units and glows (m4).
11. A `slip_warning` whose `order_ids[0]` is cancelled while the slip request is open (m5).
12. A second tap on the same row: it navigates and glows again but sends no second `MarkAlertsSeen` (m10).
13. A `ready_to_serve` re-raised by `ready_retarget` keeps the target (closed and re-raised alert, new id).
14. A 9b notification tap while signed out: `focus` survives the sign-in or is dropped (state which).
15. Phone `#/zones` tab marking (m1).
16. UR text of `alerts.target_closed`.
17. The "no second identical read" claim (01d:853), checked with a fetch spy (m3).

**Fix:** add these as 81+ or fold them into 70-80.

---

## MINOR

- **m1. The phone tab for `#/zones` is wrong.** 01d:894 says "`#/zones` has no tab, so no tab is marked (as today)". `phoneTabOf` maps `zones` → `'orders'` (`apps/client/src/features/staff/StaffApp.tsx:749-762`). Fix: "→ **Orders** (as today)".
- **m2. The primary-tile rule is slightly off.** 01d:849 says "the tile whose `primary_table_id` is null or equals its own `table_id`". A seated tile always has `primary_table_id` (`apps/hub/src/tables/queries.ts:137-139`); null means a free tile, which never matches `seating_id`. Drop "null or". Also state the archived-table group (`floor_id ''`, `queries.ts:178`): a seating whose primary table was archived mid-day has no floor to show.
- **m3. The `zone_item` check does not match `#/zones`, misses a 404, and the cost claim is wrong.**
  - `#/zones` loads `zone-stock` with **no** `zone_id` (`orders/zones/ZoneStock.tsx:42`), so the check's `?zone_id=` read (01d:850) is not the screen's read, and "no second identical read" (01d:853) is false.
  - `zone-stock` throws `404 ZONE_NOT_FOUND` for an archived zone (`orders/queries/zone-stock.ts:26`), which the spec does not map. Map it to "not open".
  - A dine-in line tap is `order-view` + the table map + `seating-orders`, not two reads. The map may come from the live `tables` catch-up part; say so.
- **m4. "Void approved → no live units" holds only for a full void.** 01d:865 and the 04 v1.0.6 changelog say so, but `VoidValues.units` can be less than the line's units (`voids/kind.ts:25`). After a partial void, the line still has live units and glows. Restate it.
- **m5. A slip can be shown as closed while it is still open.** `slip_warning` targets only `order_ids[0]`. If that order is cancelled or billed while the slip request stays open for the rest of the group, the tap says "no longer open". Check the request's own state first (01d:851 last row): an open request is open, and it then targets the first order of `order_ids` that is still open.
- **m6. Other modules' client changes have no pointers.** §3.13.5 requires changes in 02a and 02b client files:
  - `data-table` on `map/Tile.tsx`;
  - `data-seating` on `TableSheet`;
  - a controllable `open` on `Round` (today local `useState`, `table-view/Round.tsx:46`);
  - a root `data-order` on `OrderView`;
  - the table route moving the map to the tile's floor.

  Only the zones row has a pointer (02b v1.0.15 §8). Add §8 pointer lines to 02a v1.1.7 and 02b v1.0.15 (L-4a, L-4b).
- **m7. The map floor and the hidden tile are unspecified.** "The map behind the sheet shows the tile's floor" (01d:881) is new behaviour: the table route has no floor parameter today. On a landscape tablet the side panel can cover the tile it glows (01d:892). Say how the map picks the floor and keeps the tile visible beside the panel (scroll or pan the map).
- **m8. The story, the labels and the rulings disagree.**
  - `docs/stories/dl-deeplinks.md` "Tap" and acceptance 2 still say "line served … no longer open", which contradicts DL Q-2 (a).
  - "Q1 / Q2" (the first rulings: no-screen kinds; existing kinds only) and "DL Q-1 / DL Q-2" (answer sheet; served) are mixed. `docs/OPEN-QUESTIONS.md` DL-F1 cites "owner Q2 (a)" and "01d §12.8 Q-2" for food ready.
  - §12.8's last bullet (01d:1887) decides how the future food-ready kind closes, which the owner did not rule.
  - Fix: update the story, rename the first pair "DL Q-0a / Q-0b" (or similar), record them in OPEN-QUESTIONS, and drop the food-ready sentence.
- **m9. The brand glow is hard to tell from the "late" colour in dark theme.** 01d:926 says the glow cannot be confused with "late". In dark theme `--warn-fill` is `#FF9A3C` and `--warn` is `#FFB877` (`packages/ui-kit/tokens.css:62`), very close to the amber `--brand-primary` `#F4A321`. An owner-chosen red brand would also read as an error. Either soften the claim or add a ring with `--focus` / `--on-surface` contrast.
- **m10. A repeated tap is not defined.** 01d:837 ("A repeated tap … sends nothing new") does not say whether the second tap navigates and glows again. It should navigate and glow, but send no second `MarkAlertsSeen`.
- **m11. Raw route checks would ignore `focus` on some routes.** `StaffApp.tsx` matches `/audit`, `/requests`, `/test-alert` and `/receipts/<id>` as raw strings (`:509, :535-540`), so a `?focus=` on those routes would fall through to the Inbox. The spec uses none of them today. State that `focus` is only valid on the routes in the §3.13.5 table, or require those checks to go through `matchStaffRoute`'s `?` split (`shell/routes.tsx:53`).
- **m12. The Pass in-place glow is unclear.** On a Pass tablet (01d:896), does the in-place glow still run the `order-view` check, and what does a signed-out Pass tablet do? Point tablets get `ready_to_serve` escalations as a `point` target, which is lock-only.
- **m13. The "seen" rule came from the integrator, not the owner.** The "seen in every case" rule (01d:837) is an **integrator** ruling. List it in §12.8 as a point for the owner to confirm at approval, so his approval covers it.

## NIT

- **n1. Markers name both rulings where only one applies.** "⚠️ (owner 2026-11-18, DL Q-1 (a) / Q-2 (a))" is on rows that only one ruling touches (01d:800, :847-848). Cite the ruling that applies.
- **n2. The story file name.** It is `docs/stories/dl-deeplinks.md`, but the CLAUDE.md pipeline names stories `<module>-refined.md`.
- **n3. `target` on alert-mode frames is never used.** It goes on `alerts_open` and alert-mode frames (01d:779), but nothing reads it there: the lock panel is not tappable and 9b taps go to `#/inbox?focus=`. It is harmless and lock-safe; say so, or leave it off.
- **n4. A screen reader is not told where the tap landed.** The deep link moves no focus and announces nothing (01d:927). Consider a polite live text ("Opened T4, round 2").
- **n5. The 2 s length is in two places.** `--motion-glow: 2000ms` and a JS timer of 2 000 ms (01d:906, :924) can drift apart. Read the CSS variable in JS or name one constant.

---

## Answers to the brief's checks

1. **Truth against code:** the per-kind ids, the frozen values and "no added statement" on the hub are true (table above). False: "order type and current table come from `order-view`" (B1) and "after a merge the seating's tile is found" (M1).
2. **Contract:** the frozen ids survive `TableMoved` and a handover. They do not survive a merge on the absorbed side (M1), and the order → seating mapping does not survive a merge or split (B1). Lines never move between orders: there is no such event (`orders/`, `tables/` emit no line-move event). A returned line keeps its id, so a `comp` / void target stays right. The strict union, made required, fails forward and backward compatibility (M2).
3. **"No longer open" check:**
   - `order-view` answers it for dine-in (any session) but not for takeaway / parking outside the `mark-served` scope (403, B2), and it cannot route without B1's field.
   - `table-map` answers it for every device in `TABLE_MAP_DEVICE_TYPES` (`tables/queries.ts:16`), with no scope.
   - `zone-stock` answers it for any session, with the 404 caveat (m3).
   - For 403 or offline the viewer sees the error text and stays. That is acceptable for notices, but not for answerable requests (B2).
4. **Rulings:** applied consistently across §3.13, the tests, §12.8 and the module rows, except:
   - the non-dine-in `slip_warning` (M3);
   - the notices and `request_result` content (B3);
   - the story text (m8).

   Kinds with no screen (8, 12, 13, 18, 19) keep today's tap everywhere.
5. **Client:** no hash conflicts with the top bar, `/audit` or the Inbox for the routes used (m11 as a guard). The kiosk's lock-only rows navigate and never answer, as stated. Reduced motion is handled. The glow tokens use only `--brand-primary` (m9 on contrast).
6. **Tests:** see M6.
7. **Process:** all clean (table above). Foundation §6.5 needs no bump, but its "both ends validate every frame" rule is why M2 matters.
