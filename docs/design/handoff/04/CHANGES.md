# Module 04 · design changes, strings and open items

Source: the owner's design canvas (see README). Spec: `docs/specs/04_Voids_Audit_Spec_v1.0.3.md` §8 (client contract), §9 (errors), §4.5 row A-1 (day close). Plan rows VU1 / VU2.
**Spec copy wins** over frame copy unless the owner rules otherwise (§3 below lists every difference).

## 1. Design decisions (read from the frames and `design/canvas.json`)

### VU1 · Void
1. **Void sits in the selected line's controls** (`.ol.sel .ol__ctrl`), next to Comp. A line past stage 1 shows **Void**; with a `requires_approval` grant the button carries a **"Needs approval"** tag (`.ntag`, R5); with `allowed` it is plain. A stage-1 line shows no Void and keeps 02b's **Remove** (two taps) and Mark served (`VoidAction`, `VoidActionStage1`, `VoidSheetAllowed`).
2. **Void sheet = a two-column dialog** (`.dlg--v`, 940 px; 1000 px on the kiosk). Left column = what will happen: units, then **"What happens"** (every touched line with its stage chip and its outcome chip), then **"Where it goes"**. Right column = the decision: reason, amount, buttons. Tablet portrait and phone use a bottom sheet with one column; the phone puts **Reason first** and pins amount + buttons in a footer (`.vbody` / `.vfoot`).
3. **Outcome per touched line** comes from `line_dispositions`: To stock, Wastage, Released (a not-started line, `null`), Staff meal, Other, and **Parts below** for a deal header (`.vout`, VoidParts).
4. **`moved` is pre-selected** when enabled and marked **"Suggested"** (`.pre`); otherwise `wastage` is pre-selected (`VoidSheetAllowed`, `VoidWeighed`). **Disabled rows stay visible**, greyed, with a lock icon and the reason (`[aria-disabled]` + `.why`).
5. **The primary button names the missing step** and stays focusable while off (`aria-disabled`): "Pick a reason" (no chip) → "Write why first" (Other without note) → "Comp waiting" (comp_pending) → **"Ask for approval"** (saffron primary, shield icon) or **"Void"** (danger red, direct path).
6. **Other** needs two notes: the reason note ("Why?", counter `0/200`, inline error) and the disposition note inside the Other radio (`VoidSheetOther`).
7. **Units:** a 01d stepper with "of N"; locked (35 % opacity) when only 1 unit; a weighed line shows a fixed **×1** and "Weighed item — the whole line is voided." and **Rs 0** (V18, `VoidWeighed`). A deal uses **"Deal portions"** (`VoidDeal`).
8. **Amount box** "Comes off the bill" + one line saying who decides ("A manager answers on their own device. The line is locked until then." / "Leaves the bill and the kitchen at once.").
9. **Pending void on the line:** line and its child struck through on a red tint with a red **PENDING VOID** tag (`.ptag`, CSS uppercase); the order total drops it and says so in red under the total ("Rs 2,280 pending void not counted"). The requester gets a red card with a waiting ring and **Withdraw**; anyone else gets "Asked by Ali · 8:21 PM · waiting for a manager" and no buttons; **no line actions while locked** (`VoidPending`, `VoidPendingOther`).
10. **Blocked request** (served meanwhile): the card turns amber (`.wcard--blocked`) with a warning icon, the stage reads "Served · 8:24 PM", and Withdraw stays (`VoidBlocked`).
11. **Errors are inline in the sheet** (`.msg`), never a separate dialog; the text comes from spec §8, never from the server message (VoidParts heading). "Not started — use Remove" carries its own Remove button (`VoidWrongStage`).
12. **Cancel order** (`.dlg--all`, 1000 px): two groups from one void-preview — **Remove** (stage 1, read-only list, "free, no approval") and **Void** (per-line select `.dsel` with the per-entry default, a group **"Waste all"** switch that sets every select to Wastage and marks them `.is-set`). One reason for all lines. One primary: **"Remove 1 · ask to void 4"**; secondary **"Keep order"**. On a RemoveItems failure a red message sits above the groups and nothing changes; on a VoidItems failure a green "removed" message plus a red error, the Remove group is gone, the button becomes **"Try again · void 4"** and the blocking line shows a "Comp waiting" badge.
13. **Approver card** (01d D01, kind `void_approval`): the four 01d fact tiles plus a full-width **"Where it goes"** tile (icon + label) and a **"Lines and stage"** list, one row per line with its stage chip (owner Q16, D-3). A deal line shows its most advanced part (Q-16). Served meanwhile: amber message, **Approve off, Reject stays** (`AnswerVoidServed`).
14. **Day close blocked** (hub admin Stock page, owner kit): a danger banner with the count sentence and one line per open request "identifier · item · requester" (identifier LTR). Over the list limit the list scrolls inside the banner (max 196 px with a fade) and **"and 3 more"** stays visible under it (`DayCloseBlockedMore`). New kit file `css/pulse-04-admin.css` (`.pos-banner__list`).
15. **Toasts** (01d `.toast`): Void asked, Voided, Request withdrawn, Order cancelled (VoidParts).

### VU2 · Audit log
16. **New staff-nav tab "Audit log"** (list icon) after Inbox and Requests, on the office laptop (1440×900) and on tablets.
17. **Filters = three buttons** (Date, Staff, Actions) with a small label over the value; a set filter gets an accent ring and a count pill (`.flt.is-set`), an open one an accent fill (`.flt.is-open`). Caption "Newest first · hub clock". **Export CSV** at the end.
18. **Laptop rows: 8 columns** — Time · Who · Action (icon tile + words, colour by family) · Target (table chip + item ×units) · Reason · Outcome (pill) · Amount (right-aligned) · Approver (+ method tag "In person" / "On requester's device"). Empty cells show a faint dash. An unknown actor shows "?" and a shortened id ("01JDQ…G7Q2").
19. **Tablet rows: 4 columns, two lines** — Time · What (action, target, reason) · Who (+ "Approver Imran · in person") · Outcome · amount; **day headers** with the row count when the range covers several days (`AuditTablet`).
20. **Infinite scroll:** the last row is "Loading more…" with a spinner, or "That's everything for today" at the end.
21. **Popovers:** Staff = search + radio list (Everyone first, leavers marked **"left"**, hint "Matches what they did and what they approved."); Actions = grouped checkboxes with a group **All**, footer Clear / **"Show 4 actions"**; Date = presets (Today, Yesterday, Last 7 days, This month) + calendar (future days off) + From / **"To (whole day)"** + "Up to 31 days." + **"Show 7 days"**.
22. **States:** loading = skeleton rows with filters usable; empty = ring + "Nothing for these filters" + one way out "Clear filters" and Export off; hub down = calm message, filters kept, Try again, Export off.
23. **Export:** an info bar under the filters ("Exporting… 1,250 rows", progress, Stop); the Export button reads "Exporting…" and is off meanwhile.
24. **Urdu:** RTL; times, amounts and table codes stay LTR islands (`.ltr`, `.aur .t`, `.aur .am`); method shown as a tag.

### Both
25. `pulse-04.css` adds **no new tokens**: only existing tokens, fixed status colours, brand only through the v-brand variables (file header).
26. The canvas order starts with `Main.dc.html`, which is the **Void sheet** (04-D02) — the canvas calls it "VoidSheet".

## 2. Strings

Proposed keys follow the existing `apps/client/src/i18n/en.ts` style (`comp.*`, `remove.*`, `answer.*`). **Reuse** = the key already exists on `main` with this exact English text. Sample data (names, items, times, amounts, table codes) is not listed. `ur` is given where an Urdu frame shows the string; "—" = no Urdu frame (add to `urdu-todo.md` when building).

### 2.1 Line actions and stages (04-A01)
| Key | en | ur | Frames |
|---|---|---|---|
| `line.void` (replace the placeholder `'Void…'`) | Void | — | VoidAction, VoidSheetAllowed, VoidParts |
| `staff.grant.requires_approval` (reuse) | Needs approval | — | VoidAction, VoidParts |
| `comp.do` (reuse) | Comp | مفت | VoidAction, VoidSheetUrdu |
| `remove.action` | Remove | ہٹائیں | VoidActionStage1, VoidSheetUrdu |
| `served.title` (reuse) | Mark served | پیش کیا | VoidActionStage1, VoidSheetUrdu |
| `void.cancel_order` | Cancel order | — | VoidParts |
| `stage.cooking` | Cooking | پک رہا ہے | many |
| `stage.sent` | Sent to kitchen | کچن کو گیا (line) / کچن کو بھیجا (sheet) — pick one, §4 | many |
| `stage.ready` | Ready | تیار | VoidSheetAllowed, VoidKiosk |
| `stage.later` | Later | بعد میں | VoidAction… |
| `stage.served` | Served | پیش | AnswerVoidServed, VoidSheetUrdu |
| `stage.not_started` | Not started | شروع نہیں ہوا | AnswerVoid, AnswerVoidUrdu |
| `stage.weight_pending` (reuse) | Weight pending | وزن باقی | VoidAction, VoidSheetUrdu |
| `void.stage.cooking_weight_pending` | Cooking · weight pending | — | VoidWeighed, CancelOrder |
| `void.stage.served_at` | Served · {time} | — | VoidBlocked |
| `void.stage.deal_part` | {part} cooking | — | CancelOrder ("Handi cooking") |
| `orders.stage_gap` (reuse; frame adds "(Q19)", drop it) | Kitchen stages aren't sent for takeaway yet: lines show Served / Not served. | — | VoidKiosk |

### 2.2 Void sheet (04-D02, 04-C03, 04-C02)
| Key | en | ur | Frames |
|---|---|---|---|
| `void.title` | Void {item}? | {item} ووئڈ کریں؟ | Main, VoidSheetUrdu… |
| `comp.needs_manager` (reuse) | Needs a manager's approval · online only | مینیجر کی منظوری چاہیے · صرف آن لائن | Main, VoidSheetUrdu |
| `void.can_void` | You can void this · comes off the bill now | — | VoidSheetAllowed |
| `comp.units` (reuse) | Units | تعداد | Main, VoidSheetUrdu |
| `void.deal_portions` | Deal portions | — | VoidDeal |
| `void.of` | of {n} | {n} میں سے | Main, VoidSheetUrdu |
| `void.weighed_whole` | Weighed item — the whole line is voided. | — | VoidWeighed |
| `void.what_happens` | What happens | کیا ہوگا | Main, VoidSheetUrdu |
| `void.where` | Where it goes | کہاں جائے گا | Main, AnswerVoid, VoidSheetUrdu, AnswerVoidUrdu |
| `void.suggested` | Suggested | تجویز | Main, VoidSheetUrdu |
| `void.disposition.moved` | Move to ready stock | ریڈی اسٹاک میں ڈالیں | Main, AnswerVoid, VoidSheetUrdu, AnswerVoidUrdu |
| `void.disposition.moved.hint` | Cooked food goes to ready stock for the next order | پکا ہوا کھانا اگلے آرڈر کے لیے ریڈی اسٹاک میں | Main, VoidSheetUrdu |
| `void.disposition.wastage` | Wastage | ضائع | Main, VoidSheetUrdu, AuditUrdu |
| `void.disposition.wastage.hint` | Thrown away | پھینک دیا | Main, VoidSheetUrdu |
| `void.disposition.staff_meal` | Staff meal | اسٹاف کا کھانا | Main, VoidSheetUrdu |
| `void.disposition.staff_meal.hint` | Staff eat it | اسٹاف کھائے گا | Main, VoidSheetUrdu |
| `void.disposition.other` | Other | دیگر | Main, VoidSheetUrdu |
| `void.disposition.other.hint` | Say what happens to it | بتائیں اس کا کیا ہوگا | Main, VoidSheetUrdu |
| `void.disposition.other.placeholder` | What happens to it? (required) | — | VoidParts |
| `void.disposition.moved_partly` | Cooked parts to stock, the rest released | — | VoidDeal, AnswerVoidPhone, VoidParts |
| `void.disposition.moved_partly.hint` | Cooking or cooked parts go to ready stock; parts not started are let go | — | VoidDeal, VoidParts |
| `void.block.stock_not_tracked` | Stock not tracked for this item | — | VoidSheetAllowed, VoidWeighed, VoidParts |
| `void.block.not_movable_stage` | Not cooking or cooked | — | VoidParts |
| `void.block.move_not_granted` | You can't move to stock | — | VoidParts |
| `void.block.day_closed` | Business day closed | — | VoidParts |
| `void.out.moved` | To stock | اسٹاک میں | Main, VoidSheetUrdu, Audit, AuditUrdu |
| `void.out.wastage` | Wastage | ضائع | VoidSheetAllowed, VoidParts |
| `void.out.released` | Released | چھوڑ دیا | Main, VoidSheetUrdu |
| `void.out.staff_meal` | Staff meal | — | VoidParts |
| `void.out.other` | Other | — | VoidSheetOther, VoidParts |
| `void.out.parts_below` | Parts below | — | VoidDeal, VoidParts |
| `comp.reason` (reuse) | Reason | وجہ | Main, VoidSheetUrdu |
| `comp.required` (reuse) | required | ضروری | Main, VoidSheetUrdu |
| `void.reason.customer_changed_mind` | Customer changed mind | گاہک نے ارادہ بدل لیا | Main, VoidSheetUrdu, AuditUrdu |
| `void.reason.wrong_order_taken` | Wrong order taken | غلط آرڈر لیا | Main, VoidSheetUrdu |
| `void.reason.too_late` | Too late | بہت دیر ہو گئی | Main, VoidSheetUrdu |
| `void.reason.quality` | Quality | کوالٹی | Main, VoidSheetUrdu, AuditUrdu |
| `void.reason.other` | Other | دیگر | Main, VoidSheetUrdu |
| `void.note.label` | Why? | — | VoidSheetOther |
| `void.note.count` | {n}/200 | — | VoidSheetOther |
| `void.note.placeholder` | Write why | — | VoidSheetOther |
| `void.note.required` | Write why — needed for Other | — | VoidSheetOther |
| `void.amount` | Comes off the bill | بل سے کم ہوگا | Main, VoidSheetUrdu |
| `void.amount.approval` | A manager answers on their own device. The line is locked until then. | مینیجر اپنے آلے پر جواب دے گا۔ تب تک یہ لائن لاک ہے۔ | Main, VoidSheetUrdu |
| `void.amount.direct` | Leaves the bill and the kitchen at once. | — | VoidSheetAllowed |
| `void.amount.not_weighed` | Not weighed yet, so nothing is on the bill for it. | — | VoidWeighed |
| `void.amount.still_answers` | A manager still answers. | — | VoidWeighed |
| `void.cancel` | Cancel | منسوخ | Main, VoidSheetUrdu |
| `comp.ask` (reuse) | Ask for approval | منظوری مانگیں | Main, VoidSheetUrdu |
| `void.do` | Void | — | VoidSheetAllowed |
| `comp.pick_reason` (reuse) | Pick a reason | — | VoidSheetOpen |
| `void.write_why_first` | Write why first | — | VoidSheetOther |
| `void.comp_waiting` | Comp waiting | — | VoidCompPending, CancelOrderRetry |

### 2.3 Pending void (04-B01)
| Key | en | ur | Frames |
|---|---|---|---|
| `void.pending.tag` | Pending void (shown uppercase by CSS: PENDING VOID) | ووئڈ زیرِ التوا | VoidPending, VoidPendingUrdu |
| `void.pending.not_counted` | {amount} pending void not counted | {amount} زیرِ التوا ووئڈ شامل نہیں | VoidPending, VoidPendingUrdu |
| `void.pending.title` | Void pending | ووئڈ زیرِ التوا | VoidPending, VoidPendingUrdu |
| `void.pending.mine` | ×{units} · {reason} · {disposition} | ×{units} · {reason} · {disposition} | VoidPending, VoidPendingUrdu |
| `comp.withdraw` (reuse) | Withdraw | واپس لیں | VoidPending, VoidPendingUrdu |
| `void.pending.other` | Asked by {name} · {time} · waiting for a manager | — | VoidPendingOther |
| `void.pending.blocked` | Can't be approved as stock any more — withdraw and ask again | — | VoidBlocked |
| `void.pending.blocked_why` | It was served while the void waited. | — | VoidBlocked |

### 2.4 Errors (04-B02, spec §9)
| Key | en | ur | Frames |
|---|---|---|---|
| `void.err.VOID_PENDING` | A void is already waiting on this item | — | VoidParts |
| `void.err.COMP_PENDING` | A comp is waiting on this item — decide it first | — | VoidCompPending, VoidParts |
| `void.err.COMP_PENDING.hint` | Ask a manager to answer the comp, or withdraw it from the line. | — | VoidCompPending |
| `void.err.ITEM_WRONG_STAGE` | Not started — use Remove | — | VoidWrongStage, VoidParts |
| `void.err.ITEM_WRONG_STAGE.hint` | Removing is free and needs no approval. | — | VoidWrongStage |
| `void.err.ORDER_BILLED` | Bill closed — refunds are at the counter | — | VoidParts |
| `void.err.move_not_granted` (= `void.block.move_not_granted`) | You can't move to stock | — | VoidParts |
| `void.err.not_allowed.again` | Choose where it goes again. | — | VoidParts |
| `answer.error.offline` (reuse) | No connection to the hub — try again. | — | VoidParts |
| `void.err.offline.hint` | Voids need the hub; nothing was sent. | — | VoidParts |

### 2.5 Cancel order (04-D08)
| Key | en | ur | Frames |
|---|---|---|---|
| `void_all.title` | Cancel the order? | — | CancelOrder… |
| `void_all.sub` | {rounds} · removes what the kitchen hasn't started, voids the rest | — | CancelOrder… |
| `void_all.rounds` | Round {a} and Round {b} | — | CancelOrder |
| `void_all.remove_group` | Remove | — | CancelOrder |
| `void_all.remove_group.sub` | · not started · free, no approval | — | CancelOrder |
| `void_all.lines` | {n} line | — | CancelOrder |
| `void_all.void_group` | Void | — | CancelOrder |
| `void_all.void_group.sub` | · kitchen started · a manager answers each line | — | CancelOrder |
| `void_all.waste_all` | Waste all | — | CancelOrder, CancelOrderWasteAll |
| `void_all.with_child` | · with {child} | — | CancelOrder |
| `void_all.dsel.moved` | To ready stock | — | CancelOrder |
| `void_all.dsel.moved_partly` | Cooked parts to stock | — | CancelOrder |
| `void_all.reason_sub` | required · one for all lines | — | CancelOrder |
| `void_all.removed_now` | Removed lines go at once. | — | CancelOrder |
| `void_all.each_waits` | Each voided line waits for a manager. | — | CancelOrder |
| `void_all.keep` | Keep order | — | CancelOrder |
| `void_all.go` | Remove {n} · ask to void {m} | — | CancelOrder |
| `tables.err.TABLE_ALREADY_LOCKED` (reuse) + `void_all.nothing_cancelled` | Someone is taking an order here + " — nothing was cancelled" | — | CancelOrderRemoveFailed |
| `void_all.reloaded` | The list is reloaded. Try again when the table is free. | — | CancelOrderRemoveFailed |
| `void_all.removed` | {item} ×{n} removed | — | CancelOrderRetry |
| `void_all.voids_not_sent` | The voids were not sent: {error} | — | CancelOrderRetry |
| `void_all.left_below` | What is left is below. Answer or withdraw the comp, then try again. | — | CancelOrderRetry |
| `void_all.retry` | Try again · void {m} | — | CancelOrderRetry |

### 2.6 Approver card (04-D06; 01d keys reused)
| Key | en | ur | Frames |
|---|---|---|---|
| `alert.void_approval.card` / `.name` | Void request | ووئڈ کی درخواست | AnswerVoid, AnswerVoidUrdu |
| `answer.item` / `answer.quantity` / `answer.amount` / `answer.reason` (reuse) | Item / Quantity / Amount / Reason | آئٹم / تعداد / رقم / وجہ | AnswerVoid, AnswerVoidUrdu |
| `void.where` | Where it goes | کہاں جائے گا | AnswerVoid, AnswerVoidUrdu |
| `answer.void.lines` | Lines and stage | لائنیں اور مرحلہ | AnswerVoid, AnswerVoidUrdu |
| `answer.void.served_meanwhile` | Served meanwhile — ask the requester to withdraw and ask again as wastage; if they are not here, reject it and void it yourself (or anyone with void-item allowed) | — | AnswerVoidServed |
| `answer.pin_both` | Approve and Reject ask for your PIN. | — | AnswerVoid, AnswerVoidPhone, AnswerVoidPortrait |
| 01d keys (reuse): Urgent · from {name} · waiting {n} min · Reject · Approve | | فوری · از {name} · {n} منٹ سے انتظار · رد کریں · منظور | AnswerVoidUrdu |

### 2.7 Day close blocked (04-B03, 01a admin)
| Key | en | ur | Frames |
|---|---|---|---|
| `admin.stock.err.DAY_CLOSE_BLOCKED` | {count} void requests are still open — answer them first | — | DayCloseBlocked, DayCloseBlockedMore |
| `admin.stock.err.DAY_CLOSE_BLOCKED.line` | {identifier} · {item} · {requester} | — | DayCloseBlocked |
| `admin.stock.err.DAY_CLOSE_BLOCKED.more` | and {n} more | — | DayCloseBlockedMore |

### 2.8 Toasts (04-T01)
| Key | en | ur | Frames |
|---|---|---|---|
| `void.toast.asked` / `.sub` | Void asked — waiting for approval / {item} ×{n} | — | VoidParts |
| `void.toast.voided` / `.sub` | Voided / {item} ×{n} · {amount} off the bill | — | VoidParts |
| `void.toast.withdrawn` / `.sub` | Request withdrawn / {item} is back on the bill | — | VoidParts |
| `void.toast.cancelled` / `.sub` | Order cancelled / {removed} removed · {voids} voids waiting for approval | — | VoidParts |

### 2.9 Audit log (04-S03, 04-C04–C06, 04-D09)
| Key | en | ur | Frames |
|---|---|---|---|
| `audit.tab` | Audit log | آڈٹ لاگ | Audit…, AuditUrdu |
| `audit.f.date` / `audit.f.staff` / `audit.f.actions` | Date / Staff / Actions | تاریخ / اسٹاف / کام | Audit, AuditUrdu |
| `audit.f.today` | Today · {date} | آج · {date} | Audit, AuditUrdu |
| `audit.f.last7` | Last 7 days (· {range}) | — | AuditTablet, AuditExport |
| `audit.f.everyone` | Everyone | سب | Audit, AuditUrdu |
| `audit.f.all_actions` | All actions | سب کام | Audit, AuditUrdu |
| `audit.f.n_actions` | {n} actions | — | AuditActions |
| `audit.f.preset.voids` | Voids | — | AuditEmpty |
| `audit.caption` | Newest first · hub clock | نیا پہلے · ہب کا وقت | Audit, AuditUrdu |
| `audit.export` | Export CSV | CSV ایکسپورٹ | Audit, AuditUrdu |
| `audit.col.time` … `audit.col.approver` | Time · Who · Action · Target · Reason · Outcome · Amount · Approver | وقت · کس نے · کام · کس پر · وجہ · نتیجہ · رقم · منظور کرنے والا | Audit, AuditUrdu |
| `audit.col.what` / `audit.col.outcome_amount` | What / Outcome · amount | — | AuditTablet |
| `audit.action.void_requested` | Void asked | ووئڈ مانگا | Audit, AuditUrdu |
| `audit.action.void_answered` | Void answered | ووئڈ کا جواب | Audit, AuditUrdu |
| `audit.action.item_voided` | Item voided | آئٹم ووئڈ | Audit, AuditUrdu |
| `audit.action.item_moved_to_stock` | Moved to ready stock | ریڈی اسٹاک میں | Audit, AuditUrdu |
| `audit.action.item_removed` | Item removed | آئٹم ہٹایا | Audit, AuditUrdu |
| `audit.action.request_withdrawn` | Request withdrawn | — | Audit |
| `audit.action.request_pin_failed` | PIN failed on a request | — | Audit |
| `audit.action.table_lock_force_released` | Table lock released by force | — | Audit |
| `audit.action.line_comped` | Item comped | — | Audit |
| `audit.action.comp_requested` | Comp asked | — | AuditActions |
| `audit.action.comp_answered` | Comp answered | — | AuditActions |
| `audit.action.request_answered` | Request answered | — | AuditActions |
| `audit.action.request_closed` | Request closed | — | AuditActions |
| `audit.action.device_paired` | Screen paired | — | Audit |
| `audit.out.approved` / `.rejected` / `.withdrawn` / `.wrong_pin` | Approved / Rejected / Withdrawn / Wrong PIN | منظور / — / — / — | Audit, AuditUrdu |
| `audit.method.in_person` | In person (tag) · in person (tablet line) | خود آ کر | Audit, AuditTablet, AuditUrdu |
| `audit.method.on_requester_device` | On requester's device | — | Audit |
| `audit.approver_line` | Approver {name} · {method} | — | AuditTablet |
| `audit.loading_more` | Loading more… | — | Audit |
| `audit.end_today` | That's everything for today | آج کے سب اندراج | AuditActions, AuditUrdu |
| `audit.day.today` | Today · {weekday} {date} | — | AuditTablet |
| `audit.empty.title` | Nothing for these filters | — | AuditEmpty |
| `audit.empty.body` | No {actions} by {name} on {date}. Try another day or Everyone. | — | AuditEmpty |
| `audit.empty.clear` | Clear filters | — | AuditEmpty |
| `audit.err.title` | The hub can't be reached | — | AuditError |
| `audit.err.body` | Check the Wi-Fi. Your filters are kept. | — | AuditError |
| `audit.err.retry` | Try again | — | AuditError |
| `audit.staff.find` | Find a name | — | AuditStaff |
| `audit.staff.left` | left | — | AuditStaff |
| `audit.staff.hint` | Matches what they did and what they approved. "left" = no longer on the staff list. | — | AuditStaff |
| `audit.actions.group.voids_comps` / `.requests` | Voids and comps / Requests (uppercase by CSS) | — | AuditActions |
| `audit.actions.all` | All | — | AuditActions |
| `audit.actions.more_groups` | + {n} more groups | — | AuditActions |
| `audit.actions.clear` / `audit.actions.show` | Clear / Show {n} actions | — | AuditActions |
| `audit.range.today` / `.yesterday` / `.last7` / `.month` | Today / Yesterday / Last 7 days / This month | — | AuditRange |
| `audit.range.from` / `audit.range.to` | From / To (whole day) | — | AuditRange |
| `audit.range.limit` | Up to 31 days. Days later than that can't be picked. | — | AuditRange |
| `audit.range.cancel` / `audit.range.show` | Cancel / Show {n} days | — | AuditRange |
| `audit.export.running` | Exporting… / Exporting… {n} rows | — | AuditExport |
| `audit.export.stop` | Stop | — | AuditExport |
| `audit.export.saved` | Saved {file} | — | AuditExport (title only) |

## 3. Copy compared with spec §8 / §9 / §4.5 A-1 (spec wins unless the owner rules)

| # | Spec text | Frame text | Frames | Proposed |
|---|---|---|---|---|
| C1 | "You can't move to stock" (straight `'`) | "You can’t move to stock" (curly `’`) | VoidParts | Use the spec text; the apostrophe style is an owner call (O2). |
| C2 | "Can't be approved as stock any more — withdraw and ask again" | "Can’t be …" (curly) | VoidBlocked | Same as C1. |
| C3 | "… (or anyone with `void-item` allowed)" — the permission key in code style | "… (or anyone with void-item allowed)" — the key as plain text | AnswerVoidServed | Spec wins: keep "void-item". It conflicts with the 01d rule "never show a permission key" (O1). |
| C4 | Pending tag **PENDING VOID** | "Pending void", shown uppercase by `.ptag { text-transform: uppercase }`; Urdu sentence case | VoidPending, VoidParts | Same on screen in English. Screen readers read "Pending void". Accept, or store the key as "PENDING VOID" (owner). |
| C5 | Method "in person", "on requester's device" (lower case) | "In person", "On requester’s device" (sentence-case tag, curly `’`); tablet line "in person" | Audit, AuditTablet | Spec words; tag case is styling (O3). |
| C6 | Requester line "Void pending · Withdraw" | Card title "Void pending" + a separate Withdraw button | VoidPending | Same words; accepted as layout. |
| C7 | Cancel order ("Void all") | Menu and sheet say "Cancel order" / "Cancel the order?"; "Void all" not shown | VoidParts, CancelOrder | Spec names both; no change. |
| C8 | Day close: "`count` void requests are still open — answer them first" | Same; no singular drawn | DayCloseBlocked | Add a singular form "1 void request is still open — answer it first" (O9). |
| C9 | Errors §8 (VOID_PENDING, COMP_PENDING, ITEM_WRONG_STAGE, ORDER_BILLED, served meanwhile), disabled reasons, "Cooked parts to stock, the rest released", "left", "Export CSV", "Void" / "Ask for approval" | Same words | — | Match. |
| C10 | Spec gives no copy for: the button's missing-step labels, the hub-down text in the sheet, the RemoveItems failure suffix, toasts, audit empty / error | New strings (§2) | — | Not a mismatch; new keys. |
| C11 | `orders.stage_gap` on main has no "(Q19)" | "… yet (Q19): lines show …" | VoidKiosk | Reuse the existing key without "(Q19)". |

## 4. Urdu notes (frames `*Urdu`)
- **U1** "Sent to kitchen" has two translations: کچن کو گیا on the line, کچن کو بھیجا in the sheet. Use one.
- **U2** "Served" is پیش (round header) and "Mark served" is پیش کیا — fine, but check against 02's existing Urdu.
- **U3** Quote marks differ: ”کم مرچ“ (reversed) and “گاہک نے ارادہ بدل لیا”. Use one style.
- **U4** Dates keep the English month ("آج · 17 Nov"). R20 asks for Latin digits only; confirm month names (O12).
- **U5** Some `aria-label`s are English or mixed ("Imran — sign out", "Ali — سائن آؤٹ", "F2, آرڈر ہو گیا, Ali, 18 min"). Build them from keys.
- **U6** Times keep "PM" and amounts "Rs" as LTR islands — as drawn.

## 5. Open items
- **O1** Served-meanwhile copy shows the permission key `void-item` (spec §8) while 01d's rule is "never show a permission key". Owner: keep, or reword to "anyone allowed to void".
- **O2** Apostrophe style: spec uses `'`, frames `’`; `en.ts` has both. Owner to pick one for module 04.
- **O3** Audit method tag case ("In person" vs "in person").
- **O4** The staff picker shows a role ("Order taker", "Manager", …) per person. `audit-staff` (§6.5b) returns only `staff_id`, `display_name`, `in_directory`. Drop the role, or read it from the hub directory the client already has (no API change).
- **O5** Labels and groups for every `AUDIT_ACTIONS` value: the frames name 14 actions and 2 groups ("+ 4 more groups"). The rest (day, devices, PIN lockouts, stations, stock, items, boost, cancel, returns, weight, holder changes) need en + ur labels and a group.
- **O6** `module-04` has no 02 / 02b staff client yet (`apps/client/src/features/staff/orders/`, `packages/ui-kit/components/pulse-02.css` are on `main`). VU1 builds on those; merge `main` into `module-04` (or base the VU1 lane on it) first.
- **O7** Where `pulse-04.css` lands: as `packages/ui-kit/components/pulse-04.css` loaded from `app/ui-kit-staff.ts` after `pulse-02.css` (the 02 / 03 pattern), and `pulse-04-admin.css` into the kit for the 01a admin page.
- **O8** ~~Sample number plates in VoidKiosk and DayCloseBlockedMore~~ — **resolved**, owner 2026-11-17: placeholders ABC 123 / ABC 456.
- **O9** Singular day-close sentence (C8).
- **O10** States with no frame: see MAPPING.md "Gaps".
- **O11** Audit date range: "whole days on the hub clock" — the client needs the hub's time zone to build `[from, to)` (AD-15); confirm where it comes from (branch config).
- **O12** Urdu month names (U4).
