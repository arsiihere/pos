# 04 manual checks (04 plan Z2; spec §11 task 16, §12.1)

The owner runs these on a tablet, on the pilot hub, after VU1 (the Void sheet) is built. They check what the hub tests cannot: real devices, real sounds and what the screens say. The hub half of every check is already green in the gate (see the acceptance map in `04-status.md`).

Also run, in the same session:

- `docs/plans/01d-manual-checks.md` rows **1b** (urgent request on a tablet), **4** (PIN lockout on answers), **8** (sounds) and the request screens, using a `void_approval` request as the request kind (README :227). Those rows were BLOCKED until 04 shipped a request kind.
- `docs/plans/03c-manual-checks.md` **Check 10**: the printed MOVED TO STOCK slip and how the moved line looks on the KDS (04 Q-15, Q-17).

## 0. Before you start

**BLOCKED (VU1)** for checks 1–5: a void request can only be raised from the Void sheet. Check 6 (the Urdu text) can be read now from the strings below. Its on-screen look comes with check 4.

### 0.1 Build and deploy

As `01d-manual-checks.md` §0.2, at the release commit of `module-04`.

### 0.2 Devices

| Name here | Hardware | Opens |
|---|---|---|
| **TAB-A** | pilot tablet, Chrome | `http://<hub>/staff/`: the Cashier |
| **TAB-B** | second tablet, Chrome | `http://<hub>/staff/`: the Manager |
| **PHONE-H** | the table holder's phone (an Order taker) | `http://<hub>/staff/` |
| **LAPTOP** | dev laptop on the LAN | `http://<hub>/admin/stock/` (business day) |
| **KDS** | the Tandoor station screen | the KDS page |

### 0.3 People and setup

| Name here | Role | Grants (B-1 defaults) |
|---|---|---|
| **C** | Cashier | `void-item` requires approval by Manager; `move-item-to-stock` allowed |
| **M** | Manager | `void-item` allowed; `approve-void` branch |
| **H** | Order taker, holds the table | `void-item` requires approval by Manager |

Check in the owner app that the roles still hold these defaults. The business day is open. The menu has a stock-tracked **Chicken Karahi** (it draws stock, so Move to stock is offered) and a **Naan**.

---

## Check 1. The Cashier asks for a void (04 §3.5, §6.1 step 7; tests 20, 20b)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. **H** opens T7 and sends **2 x Chicken Karahi** and **2 x Naan**. On the KDS, the cook taps Start on the karahi. | The karahi is cooking; the naan is not started. | |
| [ ] | 2. On TAB-A, sign in as **C**. Open T7, tap the karahi, tap **Void**. | The Void sheet opens. It shows the units, the reason chips and the dispositions. **Move to stock** is pre-selected (C holds `move-item-to-stock` and the karahi draws stock). The button says **Ask**, not **Void**. | |
| [ ] | 3. Pick 1 unit, reason **Customer changed mind**, **Move to stock**. Tap **Ask**. | The sheet closes. The karahi line shows a **PENDING VOID** tag. The order total leaves out that unit's price. Nothing is voided yet. | |
| [ ] | 4. On TAB-A, tap the naan (not started) and try **Void**. | The app offers **Remove** (stage 1), not a void. | |
| [ ] | 5. On TAB-A, try to void the pending karahi again. | Refused: the line is waiting for an answer (`VOID_PENDING`). | |

Done by / date:

## Check 2. The Manager approves on their own tablet (04 §3.4, R22; tests 21, 22)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. On TAB-B, sign in as **M** before check 1 step 3. | At check 1 step 3, TAB-B shows the urgent request banner and plays the urgent sound (01d check 1b). The card reads `T7`, the item, `1 x`, the amount, the reason and **Moved to stock**. | |
| [ ] | 2. On TAB-B, open the request and tap **Approve**, then enter **M**'s PIN. | The request closes. On TAB-A the PENDING VOID tag goes and the unit is off the bill. TAB-A gets the "approved" result notice. | |
| [ ] | 3. Look at the KDS and the printer. | The karahi line shrinks to 1 unit. For the printed MOVED TO STOCK slip, see 03c Check 10. | |
| [ ] | 4. Ask again (another karahi unit, **Wastage**). This time **M** walks to TAB-A and answers **In person** there with a PIN. | Approved. The audit log (the VU2 screen, or `GET /queries/audit-log` on LAPTOP) names **M** as approver and says "on the requester's device". | |

Done by / date:

## Check 3. Served meanwhile (04 OQ-D; test 26b)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. T8: **1 x Chicken Karahi**, cook taps Start. On TAB-A, **C** asks to void it with **Move to stock**. | A pending request, as check 1. | |
| [ ] | 2. Before **M** answers, the cook taps Done and the waiter serves it. | The requester's PENDING VOID row now says the void cannot move a served dish, and to withdraw and ask again (`blocked: not_movable_stage`). | |
| [ ] | 3. On TAB-B, **M** taps **Approve**. | Refused before the PIN is asked, with the same message: the dish was served, withdraw and ask again as wastage (`VOID_NOT_ALLOWED`, `not_movable_stage`, hint `withdraw_and_reask`). Nothing changes on the bill. | |
| [ ] | 4. On TAB-A, **C** withdraws, then asks again with **Wastage**. **M** approves. | Approved; the unit is off the bill as wastage. | |

Write down whether the message reads clearly to the Cashier and the Manager.

Done by / date:

## Check 4. Day close is blocked, then closes (04 row A-1, Q-DC; test 24b)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. Leave one void request open (ask one on TAB-A, do not answer it). | — | |
| [ ] | 2. On LAPTOP, at `/admin/stock/`, tap **Close day**. | Refused. The banner says "1 void requests are still open — answer them first" and lists one row: table, item, requester name. The day stays open. | |
| [ ] | 3. Try **Close it and start today** (if the page offers it). | Refused the same way; no new day is opened. | |
| [ ] | 4. Answer the request (approve, reject or withdraw). Tap **Close day** again. | The day closes. | |
| [ ] | 5. (Optional, many requests) With more than 40 open requests, tap **Close day**. | 40 rows, then "and N more". | |

Switch the page to Urdu for steps 2 and 5 and do check 6 on the real screen.

Done by / date:

## Check 5. The reject notice reaches the table holder (04 V11, row D-2; test 23; AD-26)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. **H** holds T9 and is signed in on PHONE-H. T9: **1 x Chicken Karahi**, cooking. On TAB-A, **C** asks to void it. | A pending request. | |
| [ ] | 2. On TAB-B, **M** taps **Reject**. | TAB-A (**C**) gets the "rejected" result. PHONE-H (**H**, the table holder) gets a rejected-void notice too. The karahi stays on the bill. | |
| [ ] | 3. Read **H**'s card on PHONE-H. | It names the table (as it was at the raise) and says the void was rejected. It names **no item**. | |
| [ ] | 4. Repeat with **C** as the holder of the table. | **C** gets one result, not two. | |
| [ ] | 5. Repeat with **H** absent (marked absent, or signed out on every device so no route reaches them). | Nobody else gets **H**'s notice: there is no fallback to a lead or another waiter. Write down whether **H** sees anything when they come back. | |
| [ ] | 6. Repeat on a takeaway order. | Only the requester gets the result. | |

Done by / date:

## Check 6. Urdu text review of the day-close message (UA; `apps/client/src/i18n/ur.ts`)

| Key | English | Urdu today |
|---|---|---|
| `admin_stock.errors.DAY_CLOSE_BLOCKED` | `{count} void requests are still open — answer them first` | `{count} آئٹم ہٹانے کی درخواستیں ابھی کھلی ہیں — پہلے ان کا جواب دیں` |
| `admin_stock.errors.DAY_CLOSE_BLOCKED_more` | `and {n} more` | `اور {n} مزید` |

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. Read both Urdu strings. | They say what the English says, in words a manager uses. "آئٹم ہٹانے کی درخواستیں" should mean void requests, not Remove (stage 1). Write a better wording in Notes if needed. | |
| [ ] | 2. On the real screen (check 4 steps 2 and 5, page in Urdu), read the banner and the list. | The count sits in the right place in right-to-left text; "and N more" reads correctly after the list. | |

A text change is a client i18n edit (a small task), not a spec change.

Done by / date:

---

## Summary

| Check | Result | Blocked by |
|---|---|---|
| 1 Cashier asks | | VU1 |
| 2 Manager approves on own tablet | | VU1 |
| 3 Served meanwhile | | VU1 |
| 4 Day close blocked, then closes | | VU1 (to raise the request) |
| 5 Reject notice to the table holder | | VU1 |
| 6 Urdu text review | | — (screen half with check 4) |
| 01d rows 1b, 4, 8, request screens | | VU1 |
| 03c Check 10 (moved slip, KDS) | | VU1 |
