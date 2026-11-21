# 05 manual checks (05 plan task 46, Z2; spec 05 v1.0.26 §8, §11 #45–#46, §12.1 item 6)

Hand checks for 05 Billing. Spec: `docs/specs/05_Billing_Spec_v1.0.26.md`. The plan rows they come from are `05-plan.md` §8.1 M1–M8. The owner runs them **on the pilot hardware**: the hub mini PC, the Windows cashier kiosk, the pilot tablets and the pilot's own receipt printers (80 mm and 58 mm). They never run in a cloud session or in CI (CLAUDE.md "Cloud sessions and CI"). Power-loss and crash checks happen here and nowhere else (CLAUDE.md "Test environment"). Nothing here is run or ticked by the build.

They check what the gate cannot: real paper, a real cash drawer, a real QR scan, a real power cut, real timings on the real disk, and how the screens read to a cashier. The logic behind each check is already covered by the §10 tests.

**How to fill it in:** tick `[x]` when a step behaves as written. When it does not, leave `[ ]` and write what you saw in **Notes**. A photo of the paper is the best note for any print check. Fill in the **Done by / date** line under each check.

**How to report it:** `tools/local/checks-report.sh <PR> docs/plans/05-manual-checks.md` posts the filled-in list as a comment on PR `<PR>`. Use the `module-05` → `main` PR.

**Go-live rule (§12.1 item 6):** checks 1–10 and 14 pass on the pilot hardware before the pilot takes real money. If checks 11–13 (PRA) are not done, the branch starts on jurisdiction **`PK`**, not `PK-PB` (§4.3 "Pilot checklist", plan O7).

---

## 0. Before you start

### 0.1 What can run today

The hub half of 05 is built, except the PRA adapter (task 30, gated). These checks wait for something:

| Waits for | What it is | Checks or steps that wait |
|---|---|---|
| **task 30** | The PRA adapter (Appendix P). Until it lands the hub registers only the `none` adapter, so a branch cannot run on `PK-PB` | 11, 12, 13 |
| **no-sale button** | The staff app has no **Open drawer** (no-sale) button yet. The hub command `OpenCashDrawer` (§6.21, task 23) is built | check 4 steps 6–8 |
| **X / Z print button** | The Reports screen does not offer Print yet. The hub command `PrintReport` (§6.22, task 27b) is built | check 7 steps 6–9 |
| **task 45** | The 05 `test:perf` row (200-bill rush close) is not written yet | 10 |
| **O9 Urdu** | The Urdu text for the 05 screens. `docs/design/handoff/05/urdu-todo.md` still lists strings with no Urdu | 15 |

Each blocked step is marked **BLOCKED (…)** and written out in full, so it runs later without changes.

### 0.2 Build and deploy

As `01d-manual-checks.md` §0.2, at the release commit of `module-05`:

1. On the dev box: `pnpm install && pnpm test`.
2. On the mini PC: `sudo systemctl stop hub`, check out the same commit in `/opt/pos-hub`, ship the client (`apps/hub/deploy/ship-client.sh <ssh-target>`), then `sudo systemctl start hub`.
3. Check that `http://<hub>/health` answers and that `http://<hub>/staff/` loads.

### 0.3 Devices

| Name here | Hardware | Opens |
|---|---|---|
| **KIOSK** | the Windows cashier PC, Chrome or Edge kiosk mode | `http://<hub>/staff/` |
| **TAB-C** | pilot tablet with its own bill printer route | `http://<hub>/staff/` (the Cashier) |
| **TAB-M** | second tablet, **no** bill printer route of its own | `http://<hub>/staff/` (the Manager) |
| **PHONE** | an Order taker's phone | `http://<hub>/staff/` |
| **LAPTOP** | dev laptop on the LAN | `http://<hub>/admin/` (printers, stock, fiscal) |

### 0.4 Printers and the drawer

| Name here | Hardware | Paper | Route (hub admin → Printers → **Bill printers**) |
|---|---|---|---|
| **P80** | the kiosk's receipt printer, with the **cash drawer** plugged into it | 80 mm | **Device: KIOSK** |
| **P58** | a 58 mm receipt printer (if the pilot has one; else note "none") | 58 mm | **Device: TAB-C** |
| **P-FLOOR** | the bill printer for the dining floor (may be P80) | any | **Floor** (or **Zone**) of tables T1–T10 |

Set **All bills** to P80 and **Reports (X and Z)** to P80. Keep spare paper next to you.

### 0.5 People and setup

| Name here | Role | Notes |
|---|---|---|
| **CSH** | Cashier | default rights: takes payment, opens own shift, petty cash, opens the drawer |
| **MGR** | Manager | holds `close-shift-for-others` (answers petty cash and variance requests) and `close-business-day` |
| **OWN** | Owner | the second person who can answer MGR's own variance (§6.17, R-78) |
| **OT** | Order taker | holds table T7 |

- Owner app → **Billing** page for the pilot branch: jurisdiction **`PK`** (not fiscal) for checks 1–10. Payment modes **Cash** and **Card** active. Receipt header and footer filled in (branch name, address, phone). Note here the **variance limit** (Rs 100 by default) and the **petty cash limit** (Rs 5,000 by default):
  - Variance limit: ______  Petty cash limit: ______
- A business day is open (`/admin/stock/` → Start day).
- The menu has at least one taxed food item (for example **Chicken Karahi**) and **Naan**.

---

## Check 1. Receipt layout on 80 mm and 58 mm (§3.16, §6.12 step 7, §6.22, B17, B21)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. **OT** sends T7: 1 x Chicken Karahi, 4 x Naan. On KIOSK, **CSH** opens their shift (check 5 step 1), opens T7's bill and pays the whole bill in **Cash**, giving a round note above the total (for example Rs 5,000). Tap **Close bill**. | The screen shows the change due before you take it, and then "Closed · Invoice …". One receipt prints on **P80**. | |
| [ ] | 2. Read the receipt on P80. | From the top: your header lines; branch, date and time, cashier; **Invoice** with a number like `…S000001`; the item lines with units and amounts; subtotal, service charge (if set), each tax with its rate on its own line; a **Rounding adjustment** line only if rounding moved the total, never inside a tax line (§3.5, §6.26); **TOTAL PKR**; the payment line (**Cash**) and **Change**; your footer. **No** "PROVISIONAL" banner and **no** fiscal block (the branch is on `PK`, §3.15 "Not fiscalized"). Nothing runs past the paper edge. | photo: |
| [ ] | 3. Do the same on TAB-C (route **P58**) for a takeaway order paid by **Card**. | The receipt prints on **P58**. Same blocks as step 2, laid out for the narrow paper: long item names wrap, amounts stay right-aligned, nothing is cut off. No **Change** line. | photo: |
| [ ] | 4. On the T7 bill, tap **Reprint receipt**. | A second copy prints with `** REPRINT **` at the top. Same invoice number, same amounts (§6.22). | |
| [ ] | 5. Look at the bill screen's print status while P80 is printing, then switch P80 off and reprint again. Wait more than 10 s. | First: "Printing on P80…", then "Printed on P80". With P80 off: the print waits or fails, and **Print to** appears. Pick P58: "Moved to P58", and it prints there **once** (§8 Print status, §6.23, B18). | |

Done by / date:

## Check 2. Check bill (§3.16, §6.3, §6.4, B17, §7 Privacy)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. **OT** sends a new order on T3. On PHONE, tap **Ask for bill**. | A check bill prints on **P-FLOOR** (the table's zone or floor printer, not the kiosk's). | |
| [ ] | 2. Read it. | Top banner **PROVISIONAL - NOT A TAX INVOICE**. **No** invoice number, **no** fiscal number, **no** QR. Lines and totals, then **Total if paid in cash**, and **Total if paid by card** when that differs (§6.3). No buyer name or ID ever appears on it (§7 Privacy). | photo: |
| [ ] | 3. Look at T3 on the table map and in the KIOSK open-bills list. | The tile shows **Check bill printed**. The open-bills row has the "check bill printed" badge (§6.4a, §8 Cashier screen). | |
| [ ] | 4. On KIOSK, open the T3 bill and tap **Print check bill**. | "Check bill sent to …". A second check bill prints. The cash drawer does **not** open (§3.16 Drawer column: "no"). | |

Done by / date:

## Check 3. Credit note after a reopen (§3.10, §3.16, §6.13, §6.22)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. On KIOSK, as **MGR**, open the closed T7 bill (check 1) and **Reopen** it, reason **Wrong item billed**. | The bill is open again with a **Reopened** chip. A **credit note** prints on P80 (the device that reopened it). The drawer does **not** open. | |
| [ ] | 2. Read the credit note. | **CREDIT NOTE** banner; **Credit note** with a number like `…C000001`; **Against invoice** with the original's number; the same lines and amounts as the original receipt; **TOTAL CREDIT PKR**. No fiscal block (branch on `PK`). | photo: |
| [ ] | 3. Close T7 again (Cash). | A **new** receipt prints with the next sale number (`…S00000N`), not the old one (§3.10: the next close issues a new sale invoice). | |
| [ ] | 4. Tap **Reprint credit note**. | It prints again with `** REPRINT **` at the top. | |

Done by / date:

## Check 4. Cash drawer kick (§3.16, §6.12 step 7, §6.15, §6.20, §6.21, R-57, R-75)

The drawer must open only for cash, and a no-sale, shift-open or petty-cash kick must open only **this device's own** drawer. It must never fall back to another counter's printer (R-57). Note: a **close** kick travels with the receipt, and the receipt follows the normal route (the device's own printer, else **All bills**, §3.16). So a cash close on a device with no own route prints at, and opens, the **All bills** printer's drawer. If that is wrong for the pilot, write it in Notes: it is a spec question, not a build bug.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. Close any bill on KIOSK paid fully by **Card**. | Receipt prints. The drawer stays **shut**. | |
| [ ] | 2. Close a bill on KIOSK with any **Cash** (all cash, or card + cash). | Receipt prints and the drawer **opens** once. | |
| [ ] | 3. Close a bill with a cash refund (reopen, then **Give back** cash so the balance is 0, then close). | The drawer **opens** ("a cash `in` or `out` payment"). | |
| [ ] | 4. Close **CSH**'s KIOSK shift (check 5), then open a new one with **Starting cash 0** and **Use this device's cash drawer** on. | "Shift open". The drawer stays **shut** (no kick at float 0). | |
| [ ] | 5. Open a shift on KIOSK with **Starting cash** above 0. Then on **TAB-M** (no own route), open a drawer shift with starting cash above 0. | KIOSK: the drawer **opens**. TAB-M: the shift opens, nothing prints anywhere, and no drawer opens, not even P80's (R-57). If TAB-M refuses the drawer (`DRAWER_DEVICE_INVALID`), that is also right: a tablet needs a printer route to hold a drawer (§6.15). | |
| [ ] | 6. **BLOCKED (no-sale button).** On KIOSK, during an open drawer shift, tap **Open drawer**, reason **Change for customer**. | The drawer **opens**. Nothing else prints. No print-status row appears on any bill (R-75). | |
| [ ] | 7. **BLOCKED (no-sale button).** Try **Open drawer** on a device whose drawer shift is closed. | Refused: no drawer shift here (`SHIFT_NOT_OPEN`, `no_drawer_shift`). Nothing opens. | |
| [ ] | 8. **BLOCKED (no-sale button).** Remove KIOSK's own route on **Bill printers**, then tap **Open drawer**. | The no-sale is recorded, but nothing opens: not P80 through **All bills**, and no other printer (§6.21: no own route, no kick). Put the route back afterwards. | |

Done by / date:

## Check 5. Blind count, shift close and handover (§3.11, §6.16–§6.19, §7 Blind count, B23, D21)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. On KIOSK as **CSH**: **Open shift**, starting cash Rs 2,000, drawer on. Take three cash payments and one card payment (any bills). | Shift opens; the drawer kicks (check 4 step 5). | |
| [ ] | 2. Open **My shift** before counting. | **Card and online** shows its amount (to check against the card machine). The **Cash** line shows only how many payments ("3 payments"), with "count only — never the sum". **No** expected cash, **no** cash total, no variance anywhere on the screen (§6.16 blind rule). | |
| [ ] | 3. Tap **Count and close**. | The count screen says "The expected amount shows after you count — count first." There is still no expected figure. | |
| [ ] | 4. Count the real drawer and enter Rs 50 **less** than the true cash (below the variance limit). Confirm. | Only now the screen shows expected and the variance. The shift is **Closed** and the drawer is free at once. No sign-off request is raised (|variance| ≤ limit). | |
| [ ] | 5. Repeat steps 1–4, but enter an amount further off than the variance limit. | Expected and variance show after the count. "Variance sent for sign-off (pending); the drawer is free" (§8 Shift). MGR's tablet gets an urgent **Shift variance** request. | |
| [ ] | 6. **MGR** answers it with **Dispute**. | The request closes. The X report shows that shift with **disputed** (§3.14: a record only; no deduction, no reopen). | |
| [ ] | 7. **MGR** counts their own shift with a big variance. Try to answer the request as **MGR**. | MGR cannot answer their own request. **OWN** can (R-78). | |
| [ ] | 8. On a drawer shift, tap **Count at handover**, count, confirm. | The handover count shows its own expected and variance. The shift stays **Open** (§6.19). | |
| [ ] | 9. As a person without `skip-blind-count`, try **Close without counting**. | Refused: "You can't skip the count". | |

Done by / date:

## Check 6. Petty cash and the drawer (§3.12, §6.20, §3.14, B24)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. On KIOSK in an open drawer shift as **CSH**: petty **Cash out**, Rs 300, a category, paid to "Milk vendor". | Recorded at once. The drawer **opens**. | |
| [ ] | 2. **Cash out** above the petty cash limit (for example Rs 6,000). | Not recorded yet: a **Petty cash** request goes to **MGR** (holders of `close-shift-for-others`). The drawer stays **shut**. | |
| [ ] | 3. **MGR** approves on TAB-M with their PIN. | The entry is recorded on CSH's shift. The drawer does **not** open by itself; CSH opens it with the no-sale button (§6.20; **BLOCKED (no-sale button)** for that last part). | |
| [ ] | 4. Give an **Advance** of Rs 1,000 to a staff member. Then **Settle** it with spent Rs 600 + returned Rs 300. | Refused: "Spent and returned must add up to Rs 1,000". Settle with 600 + 400: settled. | |
| [ ] | 5. Leave a second advance open and **Count and close** the shift. | The open advance is listed ("open · doesn't stop the count") and does not block the close (§3.11). The count's expected cash includes the petty cash in and out. | |
| [ ] | 6. Open the X report. | Petty cash shows by category and kind; the open advance shows who, how much and its age. The vendor's name ("Milk vendor") does **not** appear on the X (§6.20 audit, §7 Privacy). | |

Done by / date:

## Check 7. Day close, the Z print, and X / Z reprints (§3.13, §6.22, §6.24–§6.26, §8 Day close and Reports)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. Leave one shift open and one order on T5 unbilled. As **MGR**, open **Close the day** in the staff app and tap **Close day**. | Refused, one thing at a time, in this order: void requests, open shifts, pending sign-offs, orders not billed (§3.13). Here it lists the **open shift** first, with **Close this shift**. | |
| [ ] | 2. Close the shift (blind count applies to the closer). Tap **Close day** again. | Now it lists T5 under **Orders not billed**, with **Carry over**. | |
| [ ] | 3. Tick T5, **Carry over**, reason **Table still seated**. Tap **Close day**. | "Day closed · Z N". The **Z prints by itself** on the **Reports (X and Z)** printer (P80). | |
| [ ] | 4. Read the Z. | Sales (gross, discounts, service charge, net, tax by tax and rate, **Rounding** on its own line, total); credits and **Net after credits** (check 3's credit is here); payments by mode (in, back, change given); comps and voids; reopens; petty cash; each shift with float, expected, counted, variance and sign-off state; invoice and bill counts and the average bill; **carried forward** for T5's order. **No** buyer name or ID, and no vendor name (§7 Privacy). | photo: |
| [ ] | 5. Next day: open the day, then open the X report. | T5's order is still open and shows under **brought forward** if it had payments (§6.26). | |
| [ ] | 6. **BLOCKED (X / Z print button).** In **Reports → Today (X)**, tap Print. | An X prints on the Reports printer. A shift that is not counted yet shows **no** expected cash (§6.26 reading 8). | |
| [ ] | 7. **BLOCKED (X / Z print button).** In **Z reports**, print yesterday's Z. | It prints again, same Z number and figures (§6.22 reading 1). | |
| [ ] | 8. **BLOCKED (X / Z print button).** Switch P80 off and print the X. | The print falls back to **All bills**. If that is P80 too, nothing prints, and the screen says so; nothing errors (§6.22 reading 5). | |
| [ ] | 9. **BLOCKED (X / Z print button).** On a hub with the day closed and not reopened, print the X. | Refused: the day is not open (`BUSINESS_DAY_NOT_OPEN`, reading 4). | |

Done by / date:

## Check 8. Offline: money is refused, never queued (§6 "not queueable", §7 Offline, §8 Bill screen, G0-1)

Two different "offline" cases. A device that cannot reach the **hub** must not take money. A hub that cannot reach the **internet** keeps billing.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. Open a bill on TAB-C. Turn TAB-C's Wi-Fi **off**. | The bill screen says "Reconnecting to the hub… · Showing what we had as of … · every bill action needs the hub". The payment pad says **Needs the hub**: "Payments, Close and every bill sheet wait for the hub. Nothing is queued — money is never taken offline." | |
| [ ] | 2. While offline, try to add a payment, close, apply a discount, open a petty cash sheet, and count the shift. | Each one is refused on the spot with **Needs the hub**. Nothing looks "sent" or "waiting to send". | |
| [ ] | 3. Turn Wi-Fi back **on** and wait for the screen to refresh. | **No** payment, close, discount, petty entry or count appears that you tried offline. The bill is as it was before step 2. | |
| [ ] | 4. Unplug the **internet** line from the restaurant router (keep the LAN up). Take a cash payment and close a bill on KIOSK; open and close a shift; record petty cash. | All of it works as normal (§7 Offline). Only the fiscal answer would wait, and on `PK` there is none. Plug the internet back in. | |

Done by / date:

## Check 9. Power loss in the middle of a close (§7 Idempotency and Gap-free numbers, §3.15 "At least once", B13, B20; plan M7)

**Pilot hub only.** This is the 03a task 28 style check: real power, real disk, `synchronous=FULL`. Never on a dev laptop (CLAUDE.md). Use the UPS switch or pull the mini PC's plug, not `systemctl`.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. Write down the last invoice number from the X report (**Invoices** count) and the last receipt you printed. | last invoice: | |
| [ ] | 2. On KIOSK, put a cash payment on a bill and tap **Close bill**. **At the same moment**, pull the mini PC's power. | KIOSK shows it cannot reach the hub. | |
| [ ] | 3. Power the mini PC back on. Time it until `http://<hub>/health` answers. | The hub is back by itself (systemd), within 90 s. | boot took: |
| [ ] | 4. Look at the bill on KIOSK (it reconnects by itself). If it still shows **Close bill**, tap it once. | Either the bill is already **Closed** with one invoice, or it closes now with one invoice. Never two invoices for the bill. If the KIOSK retried the same close, the hub returns the same invoice (D32). | |
| [ ] | 5. Open the X report and the bill's receipts. | The invoice count went up by exactly **one**. The numbers run with **no gap and no repeat** (for example S000041, S000042). The payment counts once in the shift. | |
| [ ] | 6. Check the paper. | At most one receipt for that invoice, plus a `** REPRINT **` copy if the print was cut off by the power loss (03c Check 8). A duplicate copy is fine; a missing invoice is not. | |
| [ ] | 7. Repeat steps 2–6 three times, cutting the power at a slightly different moment each time (just before, at, just after the tap). | Same result each time. | |
| [ ] | 8. *(After task 30, on `PK-PB` with the sandbox.)* Cut the power just after a close, before its fiscal number comes back. Power on. | The invoice is sent to PRA again with the **same** invoice reference, and gets **one** fiscal number. A reprint shows that number (§3.15, test #70). | |

Done by / date:

## Check 10. The 200-bill rush close — `test:perf` (§7 Performance, §11 #45; plan M1)

**BLOCKED (task 45).** The 05 perf row is not written yet. When it lands, run it on the **pilot hub**, on the **real disk**, alone on a quiet machine. Never with `TMPDIR=/dev/shm`, never on tmpfs, never in the cloud or CI (CLAUDE.md).

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. Stop anything else on the mini PC that uses the disk or the CPU. Check that no gate is running (`/tmp/pos-gate.lock` is free). | Quiet machine. | |
| [ ] | 2. From the repo on the mini PC: `pnpm test:perf`. Do **not** set `TMPDIR`. | The run finishes. The 05 row (200-bill rush close) passes its numbers. | |
| [ ] | 3. Post the numbers: `tools/local/perf-report.sh` (as 03a). | Numbers posted on the PR. | close p95: |

Done by / date:

## Check 11. Buyer ID: full on the customer's receipt only, last 4 on the credit note (B19, §6.12 step 7, §6.22, §7 Privacy, row P-5; plan M5)

**After task 30.** The buyer ID is asked only on `PK-PB` (bills of Rs 50,000 or more), and the hub can run `PK-PB` only once the PRA adapter lands. Use the PRA **sandbox** (check 13).

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. Make a bill of Rs 50,000 or more. Tap **Close bill**. | The buyer sheet opens: name, a type (CNIC or NTN), the number. **Customer refuses** is there too. | |
| [ ] | 2. Enter a name and a test CNIC (13 digits). Close. | The **customer's receipt** shows the buyer name and the **full** CNIC with its label. | photo: |
| [ ] | 3. Look at every screen: the bill, open bills, the shift, the X, the Requests list. | The CNIC appears **nowhere** on a screen (§7 Privacy). | |
| [ ] | 4. **Reprint receipt**. | The reprint also shows the full CNIC (it is that customer's receipt). | |
| [ ] | 5. Reopen the bill. Read the **credit note**. | It shows only `CNIC: ****` and the **last 4** digits. Never the full number. | photo: |
| [ ] | 6. Print a check bill for a big bill before close, and read the X and the next Z. | No buyer name or ID on the check bill, the X or the Z. | |
| [ ] | 7. Do steps 1–5 again with an **NTN**. | Same rules for the NTN. | |
| [ ] | 8. Big bill, **Customer refuses**, as a Cashier who needs approval. | A request goes to the Manager. After approval the bill closes with no buyer ID. | |

Done by / date:

## Check 12. QR on the receipt when fiscal (§3.16, §6.22, A3, row P-3, R-26, R-55; plan M3)

**After task 30**, on `PK-PB` with the PRA sandbox (check 13). Run on **each printer model** the pilot uses.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. Close a bill while the hub cannot reach PRA (internet unplugged). | The receipt prints with **FISCAL NUMBER PENDING** and no QR. The close was not slowed down. | |
| [ ] | 2. Plug the internet back. When the fiscal status line shows "all sent", **Reprint receipt**. | The reprint shows **PRA invoice no.** with the fiscal number, and a **QR at the foot**, with no logo. | photo: |
| [ ] | 3. Look at the QR size on **P80** and on **P58**. | P80: a larger QR (module size 6). P58: a smaller one (module size 4). Both fit the paper with a margin. | |
| [ ] | 4. Scan each QR with a phone camera. | It opens PRA's invoice search page for that fiscal number. | P80 scan: P58 scan: |
| [ ] | 5. Close a bill that PRA **rejects** (Appendix P sandbox case), then reprint. | **FISCAL NUMBER NOT ISSUED**, no QR. A manager alert is raised. | |

Done by / date:

## Check 13. PRA sandbox run (§3.15 "Live sandbox runs are manual owner steps", Appendix P, G1-12; plan M2, O4)

**After task 30.** Needs the PRA **sandbox** token (owner task O4). Type the token only into the hub admin page. Never into the repo, a chat, the spec or the cloud.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. LAPTOP → `http://<hub>/admin/fiscal/` as **OWN**. Type the sandbox token for the POS ID and tap Save. | "Token: set on <date>". The field is empty again, and it is never filled from the hub. | |
| [ ] | 2. Owner app → Billing: jurisdiction **`PK-PB`**, environment **sandbox**. | The cashier screen shows a fiscal status line. | |
| [ ] | 3. Close one bill each way: all **cash**, all **card**, **card + cash**. | Each gets a fiscal number. The fiscal status line returns to "all sent". | |
| [ ] | 4. Reopen one of them. | The credit note gets its own fiscal number, after its original's. | |
| [ ] | 5. A buyer bill of Rs 50,000 or more (check 11 step 2). | Accepted with the buyer ID. | |
| [ ] | 6. Unplug the internet, close a bill, wait 1 minute, plug it back. | The line shows "Fiscal: 1 waiting …" while unplugged. The bill is sent again by itself and gets **one** fiscal number. | |
| [ ] | 7. Reprint one receipt from step 3. | Fiscal number and QR (check 12). | |
| [ ] | 8. Switch the branch back to **`PK`** (or go live per check 16). | — | |

Done by / date:

## Check 14. Money requests on two tablets (§3.14, R-49; plan M6)

Run with `01d-manual-checks.md` rows **1b** (urgent request), **4** (PIN lockout on answers) and **8** (sounds), as 04 did, using two 05 request kinds.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. On TAB-C as **CSH** (discount needs approval), apply a 10 % discount on a bill. | TAB-M (**MGR**) shows an **urgent** request and plays the urgent sound. The card shows the bill, the amount and the reason. CSH's Close button is blocked while it waits. | |
| [ ] | 2. **MGR** approves with their PIN. | The discount appears on CSH's bill and the totals update. | |
| [ ] | 3. A **Shift variance** request (check 5 step 5). | Same urgent banner and sound on TAB-M. Answer: **Approve** or **Dispute**, PIN always asked. | |
| [ ] | 4. Enter a wrong PIN several times on an answer. | The 01d PIN lockout applies (01d row 4). | |

Done by / date:

## Check 15. Urdu screens (§8 i18n, D12, R20)

**After the O9 design.** The Urdu text for the 05 screens is not finished (`docs/design/handoff/05/urdu-todo.md`). Until then, Urdu falls back to English on those strings.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | 1. Switch TAB-C to Urdu. Open: open bills, a bill with the payment pad, the split editor, the buyer sheet, My shift and the count, petty cash, Close the day, Reports. | Every label is in Urdu, right to left, and fits. No English left except names and numbers. | |
| [ ] | 2. Look at every amount and number. | **Latin digits** (0–9) in Urdu, never Urdu digits. Amounts are formatted as on the English screen (§8 i18n). | |
| [ ] | 3. Make each 05 error happen once where you can (for example, close with a void pending; an over-limit refund). | Each error has a clear Urdu text. Day-close blockers show as a list. | |

Done by / date:

## Check 16. Go-live checklist (§4.3 "Pilot checklist", G1-16, §12.1 item 6; plan M8, O3–O7)

| ☐ | Item | Expected | Notes |
|---|---|---|---|
| [ ] | 1. Checks 1–10 and 14 pass on the pilot hardware. | All ticked, or each gap written down and accepted by the owner. | |
| [ ] | 2. POS ID(s) registered with PRA (O3). | | |
| [ ] | 3. Production token entered on `/admin/fiscal/`, environment **production** (O5). | "Token: set on <date>". | |
| [ ] | 4. Check 13 passed (one sandbox run). | | |
| [ ] | 5. Owner's / accountant's written OK that only the POS floor reports to PRA (O6, R20). | | |
| [ ] | 6. Decision (O7): all of 2–5 done → jurisdiction **`PK-PB`**; any missing → start on **`PK`** and switch later in the Billing settings (no code change). | Chosen: `PK-PB` / `PK` | |
| [ ] | 7. 01c data entry: `is_default` is off unless an option really is the default (O8, M-2). | | |

Done by / date:

---

## Summary

| Check | Result | Blocked by |
|---|---|---|
| 1 Receipt layout, 80 / 58 mm, reprint, Print to | | — |
| 2 Check bill | | — |
| 3 Credit note after reopen | | — |
| 4 Drawer kick (close, shift open, own route only) | | no-sale button (steps 6–8) |
| 5 Blind count, sign-off, handover | | — |
| 6 Petty cash and the drawer | | no-sale button (step 3, last part) |
| 7 Day close, Z print, X / Z reprint | | X / Z print button (steps 6–9) |
| 8 Offline: refused, not queued; hub without internet | | — |
| 9 Power loss mid-close (pilot hub) | | task 30 (step 8 only) |
| 10 200-bill rush `test:perf` (real disk) | | task 45 |
| 11 Buyer ID: full on receipt, last 4 on credit note | | task 30 |
| 12 QR on the fiscal receipt, per printer | | task 30 |
| 13 PRA sandbox run | | task 30, O4 |
| 14 Money requests on two tablets | | — |
| 15 Urdu screens | | O9 Urdu text |
| 16 Go-live checklist | | 1–14 |
