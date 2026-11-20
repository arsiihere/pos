# 05 — Urdu to do

Every §6 string with **no Urdu frame** in this hand-off. Strings drawn in the 7 Urdu frames (OpenBillsUrdu, BillUrdu, BuyerUrdu, ShiftUrdu, PettyUrdu, DayCloseUrdu, AnswerUrdu05) are not listed; their Urdu text is in those frames (copy it into `ur.ts`).

| Key | English |
|---|---|
| `billing.list.open_for` | Open {duration} |
| `billing.list.empty` | No open bills |
| `billing.list.as_of` | as of {time} |
| `billing.list.empty_sub` | Bills show here as soon as a table orders or a takeaway is placed. |
| `billing.list.load_failed` | Couldn't load the bills. |
| `fiscal.line.ok` | Fiscal: all sent · last {time} |
| `fiscal.line.stuck` | Fiscal: {n} waiting · oldest {duration} — tell a manager |
| `fiscal.line.rejected` | Fiscal: {n} not accepted — tell a manager |
| `fiscal.line.token_missing` | Fiscal: not set up on this hub — tell the owner |
| `fiscal.line.failing/ `.unknown`` | Fiscal: can't reach the authority / Fiscal: not checked yet |
| `shift.open_prompt` | Open your shift to take money |
| `billing.prices_include_tax` | Prices include tax |
| `billing.dues.paid_left` | Paid {paid} · Left {left} |
| `billing.refund.cash/ `.card`` | Refund cash {amount} / Refund card {amount} |
| `billing.mixed_note` | Any cash on this split makes the whole split cash rate |
| `billing.tag.comp/ `.pending_void` / `.weight_needed` / `.tax_unresolved` / `.new`` | COMP / PENDING VOID / WEIGHT NEEDED / Tax not set / New |
| `billing.locked_split` | Paid · {invoice_ref} |
| `billing.split_tab` | Split {n} |
| `pad.total_card/ `pad.total_cash` / `pad.total_mode`` | Total by card {amount} / Total in cash {amount} / Total by {mode} {amount} |
| `pad.amount/ `pad.tendered` / `pad.change_due` / `pad.reference`` | Amount / Cash given / Change due {amount} / Reference |
| `pad.add/ `pad.give_back`` | Add payment / Give back |
| `pad.payment.in/ `.out` / `.tendered_change` / `.has_reference` / `.by`` | In / Back / Given {tendered} · Change {change} / Has reference / by {name} |
| `billing.blocks.bill_not_open` | This bill is already closed |
| `billing.blocks.void_pending` | {n} items waiting for void approval: {items} |
| `billing.blocks.weight_pending` | {n} items need a weight: {items} |
| `billing.blocks.tax_unresolved/ `.tax_unresolved_sc`` | Tax is not set for {items} — ask the owner / Tax is not set for the service charge — ask the owner |
| `billing.blocks.discount_pending` | A discount is waiting for approval |
| `billing.blocks.shares_sum` | Split amounts no longer add up — edit the split |
| `billing.give_change` | Give change {amount} |
| `billing.fiscal.pending/ `.number` / `.rejected` / `.not_required`` | Fiscal number pending / {label} {fiscal_number} / Not accepted by the authority / — |
| `billing.total_changed` | The total changed to {amount} — check it and close again |
| `billing.reopen_mode.full/ `.corrections`` | Full edit: add, remove or change items / Corrections only: remove, void or comp; new items go on a new bill |
| `billing.buyer.needed/ `.added` / `.waived`` | Buyer details needed above {threshold} / Buyer added — sent with Close / Customer refused buyer details |
| `billing.read_only` | Total if paid in cash {cash} · By card {card} |
| `billing.reprint_receipt/ `.reprint_credit`` | Reprint receipt / Reprint credit note |
| `billing.print.waiting/ `.printed` / `.failed` / `.none` / `.print_to`` | Printing on {printer}… / Printed on {printer} / Didn't print on {printer}: {error} / No bill printer set up / Print to |
| `billing.check_sent` | Check bill sent to {printer} |
| `billing.no_printer` | No bill printer is set up — show the screen to the customer |
| `billing.print.kind.check/ `.receipt` / `.credit`` | Check bill / Receipt / Credit note |
| `billing.print.failed_plain` | Didn’t print on {printer} |
| `split.title/ `.items` / `.amount` / `.equal` / `.one` / `.add`` | Split the bill / Items / Amount / Equally / One bill / Add split |
| `split.not_placed/ `.to_share` / `.save`` | {n} items not placed / {amount} to share · {left} left / Save split |
| `print.waiting/ `.printed` / `.failed` / `.none` / `.print_to`` | Printing on {printer}… / Printed on {printer} / Didn't print on {printer}: {error} / No bill printer set up / Print to |
| `billing.split.title/ `.items` / `.amount` / `.equal` / `.one` / `.add`` | Split the bill / Items / Amount / Equally / One bill / Add split |
| `billing.split.not_placed/ `.to_share` / `.save`` | {n} items not placed / {amount} to share · {left} left / Save split |
| `billing.split.sub` | Re-plan how the open part is paid |
| `billing.split.add_hint` | 2–20 splits |
| `billing.split.items_hint` | Tap an item, then tap a split to move it. Items with more than one unit move one at a time (“3 of 6”). A deal moves whole; options go with their item. |
| `billing.split.lines` | {n} lines |
| `billing.split.unit_of` | {units} of {total} |
| `billing.split.pool` | Not placed |
| `billing.split.items_count` | {n} items |
| `billing.split.all_placed` | Every item is placed |
| `billing.split.left` | {n} left |
| `billing.split.locked_note` | Paid — can’t change |
| `billing.split.has_payment` | has a payment · {amount} |
| `billing.split.new_after` | New — added after split {n} closed |
| `billing.split.cash` | cash |
| `billing.split.amount_hint` | Shares are in the cash total. Each split’s card total comes back from the hub after Save. The hub re-bases the last open share when the bill changes. |
| `billing.split.how_many` | How many people |
| `billing.split.equal_hint` | 2 to 20 · over the open part |
| `billing.split.fewer` | One fewer |
| `billing.split.more` | One more |
| `billing.split.place_first` | Place {n} items first |
| `billing.split.make_add_up` | Make it add up to {amount} |
| `billing.split.two_needed` | Place items in at least 2 splits |
| `billing.split.paid_empty` | Split {n} has a payment — keep at least one item on it |
| `sheet.ask_approval/ `sheet.pick_reason` / `sheet.write_why`` | Ask for approval / Pick a reason / Write why first |
| `discount.waiting` | Waiting for {name} or a manager · {value} · {reason} |
| `sc.remove/ `.add_back` / `.removed`` | Remove / Add back / Service charge removed |
| `sc.reason.customer_request/ `.service_complaint` / `.staff_meal` / `.other`` | Customer asked / Service complaint / Staff meal / Other |
| `billing.sc.remove/ `.add_back` / `.removed`` | Remove / Add back / Service charge removed |
| `billing.sc.reason.customer_request/ `.service_complaint` / `.staff_meal` / `.other`` | Customer asked / Service complaint / Staff meal / Other |
| `billing.sheet.reason` | Reason |
| `billing.sheet.note` | Note |
| `billing.sheet.note_ph` | Write why (needed for Other) |
| `billing.sheet.count` | {n} / 200 |
| `billing.sheet.pick_reason` | Pick a reason |
| `billing.sheet.write_why` | Write why first |
| `billing.sheet.ask` | Ask for approval |
| `billing.sheet.waiting` | Waiting for approval |
| `billing.sheet.withdraw` | Withdraw |
| `billing.sheet.back` | Back to the bill |
| `billing.discount.title` | Discount the bill |
| `billing.discount.sub` | Whole bill |
| `billing.discount.amount` | Amount |
| `billing.discount.percent` | Percent |
| `billing.discount.hint` | Whole bill. The new totals come from the hub after it is applied. |
| `billing.discount.enter` | Type the discount first |
| `billing.discount.apply` | Give discount |
| `billing.discount.remove` | Remove discount |
| `billing.discount.remove_title` | Remove the discount |
| `billing.discount.applied` | Discount applied |
| `billing.discount.removed` | Discount removed |
| `billing.discount.close_waits` | You can keep working on the bill. Close waits until the discount is answered — the totals change only if it is approved. |
| `billing.sc.label` | Service charge {rate} |
| `billing.sc.label_plain` | Service charge |
| `billing.sc.title` | Remove service charge |
| `billing.sc.remove` | Remove |
| `billing.sc.add_back` | Add back |
| `billing.sc.removed` | Service charge removed |
| `billing.sc.confirm` | Add the {rate} back? |
| `billing.sc.totals_after` | Totals after |
| `billing.sc.from_hub` | from the hub |
| `billing.sc.stays` | Removed stays removed: nothing adds it back by itself. Someone allowed to remove it can tap Add back on the row. |
| `billing.sc.reason.customer_request` | Customer asked |
| `billing.sc.reason.service_complaint` | Service complaint |
| `billing.sc.reason.staff_meal` | Staff meal |
| `billing.sc.reason.other` | Other |
| `reopen.title/ `.what_happens` / `.done`` | Reopen bill / Each paid split gets a credit note. Payments stay. Close again to issue new invoices. / Reopened · credit {credit_ref} {amount} |
| `reopen.reason.wrong_item_billed/ `.wrong_payment_mode` / `.customer_returned_item` / `.price_error` / `.other`` | Wrong item billed / Wrong payment type / Customer returned an item / Price error / Other |
| `comp_remove.title/ `.done`` | Remove comp / Comp removed · {amount} back on the bill |
| `comp_remove.reason.comped_by_mistake/ `.wrong_line` / `.other`` | Comped by mistake / Wrong line / Other |
| `payment_remove.title/ `.done` / `.shift_closed`` | Remove payment / Payment removed / This payment's shift is already counted — it can't be removed. Give the money back from your shift instead. |
| `payment_remove.reason.wrong_mode/ `.wrong_amount` / `.customer_changed` / `.other`` | Wrong payment type / Wrong amount / Customer changed their mind / Other |
| `shift.opened` | Shift open · drawer opened |
| `shift.expected/ `.variance_short` / `.variance_over` / `.variance_exact`` | Expected / Short {amount} / Over {amount} / Exact |
| `shift.variance_pending` | Variance sent for sign-off (pending); the drawer is free |
| `shift.petty_cancelled` | {n} petty cash request was cancelled because the shift closed |
| `shift.other_title` | {name}'s shift |
| `petty.waiting/ `.approved_open_drawer`` | Waiting for a manager · {kind} {amount} · {category} / Approved — open the drawer to take the cash |
| `petty.settle/ `.spent` / `.returned` / `.settled`` | Settle / Spent / Returned / Settled |
| `drawer.open/ `.opened`` | Open drawer / Drawer opened |
| `drawer.reason.change_for_customer/ `.check_cash` / `.other`` | Change for a customer / Check the cash / Other |
| `dayclose.blocked.unbilled/ `_one`` | {count} orders are not billed — bill them or carry them over / 1 order is not billed — bill it or carry it over |
| `dayclose.blocked.voids` | reuse `admin_stock.errors.DAY_CLOSE_BLOCKED`, `_one`, `_more` |
| `carry.reason.table_still_seated/ `.customer_will_pay_later` / `.other`` | Table still seated / Customer will pay later / Other |
| `dayclose.done` | Day closed · Z {z_no} |
| `reports.rounding/ `.brought_forward` / `.carried_forward` / `.net_after_credits`` | Rounding / Brought forward / Carried forward / Net after credits |
| `reports.signoff.pending/ `.approved` / `.disputed`` | Pending sign-off / Approved / Disputed |
| `reports.retry_done/ `.rejected_note`` | {n} waiting — sending now / Not accepted invoices need a fix from support |
| `alert.remove_service_charge.name/ `.card` / `.lock`` | Remove service charge / Remove service charge · {identifier} · {reason} / {table} · Remove service charge · {requester} |
| `alert.reopen_bill.name/ `.card` / `.lock`` | Reopen bill / Reopen bill · {identifier} · {reason} / {table} · Reopen bill · {requester} |
| `alert.remove_comp.name/ `.card` / `.lock`` | Remove comp / Remove comp · {identifier} · {amount} · {reason} / {table} · Remove comp · {requester} |
| `alert.close_without_buyer_id.name/ `.card` / `.lock`` | No buyer details / Close without buyer details · {identifier} · {amount} / {table} · No buyer details · {requester} |
| `alert.petty_cash.name/ `.card` / `.lock`` | Petty cash / Petty cash · {amount} · {reason} / Petty cash · {requester} |
| `alert.shift_variance.name/ `.card` / `.lock` / `.approve` / `.reject`` | Shift variance / Shift variance · {requester} · {amount} / Shift variance · {requester} / Approve / Dispute |
| `alert.fiscal_outbox_stuck.name/ `.card` / `.lock` / `.help`` | Fiscal records stuck / Fiscal records stuck · {quantity} waiting · oldest {minutes} min / Fiscal records stuck / Tax invoices are not reaching the authority. Tell the owner. |
| `alerts.closed.day_closed/ `.shift_closed`` | Closed: day closed / Closed: shift closed (beside the existing `.bill_closed`) |
| `errors.BILL_NOT_FOUND` | This bill can't be found — go back to Bills |
| `errors.SHIFT_NOT_FOUND` | This shift can't be found |
| `errors.INVOICE_NOT_FOUND` | This invoice can't be found |
| `errors.PAYMENT_NOT_FOUND` | This payment was already removed |
| `errors.PAYMENT_MODE_NOT_FOUND` | This payment type was removed — pick another |
| `errors.PETTY_CASH_NOT_FOUND` | This advance can't be found |
| `errors.Z_REPORT_NOT_FOUND` | This Z report can't be found |
| `errors.BILL_NOT_OPEN/ `_cancelled`` | This bill is already closed / This order was cancelled |
| `errors.BILL_CLOSE_BLOCKED` | Can't close yet: {reasons} (reasons as `billing.blocks.*`) |
| `errors.DISCOUNT_PENDING` | A discount is waiting for approval |
| `errors.SERVICE_CHARGE_NOT_APPLIED` | The service charge was already removed |
| `errors.BUYER_ID_REQUIRED` | Buyer details are needed above {threshold} |
| `errors.BILL_TOTAL_CHANGED` | The total changed to {amount} — check it and close again |
| `errors.BILL_BALANCE_DUE` | {amount} still to take on split {n} |
| `errors.BILL_PARTLY_PAID` | A split is already paid — no discount now |
| `errors.LINE_IN_CLOSED_SPLIT` | Reopen the bill to change a paid split |
| `errors.BILL_HAS_PAYMENTS` | Split {n} has a payment — remove the payment first or keep the split (merge / split of the table: "This bill has a payment — the tables can't be joined or split now") |
| `errors.BILL_HAS_PAYMENTS_tables` | This bill has a payment — the tables can't be joined or split now |
| `errors.BILL_REOPEN_PENDING` | A reopen is already waiting for approval |
| `errors.BILL_REOPEN_NOT_SUPPORTED` | This bill can't be reopened: its tax invoice can't be credited here — ask the owner |
| `errors.LINE_NOT_COMPED` | This item is not comped |
| `errors.SHIFT_NOT_OPEN.no_shift/ `.no_drawer_shift` / `.not_open` / `.payment_shift_closed`` | Open your shift to take money / This device has no open drawer shift / This shift is already closed / This payment's shift is already counted — give the money back from your shift instead |
| `errors.SHIFT_ALREADY_OPEN` | Your shift is already open |
| `errors.DRAWER_IN_USE` | This drawer is in {name}'s open shift — they must close it first, or open without the drawer |
| `errors.PETTY_ADVANCE_SETTLED` | Already settled |
| `errors.BILL_SPLIT_INVALID.units_missing/ `.units_exceed` / `.deal_whole` / `.option_with_parent` / `.shares_sum` / `.split_closed`` | Every item must be in a split — {item} is not / {item} is placed more than once / A deal moves as a whole / Options go with their item / Amounts must add up to {amount} / A paid split can't be changed |
| `errors.DISCOUNT_TOO_LARGE` | The most you can give is {amount} |
| `errors.PAYMENT_MODE_NOT_FISCAL` | {mode} can't be used for a tax invoice here — use another, or remove it and take it again |
| `errors.PAYMENT_EXCEEDS_BALANCE/ `_zero_in` / `_zero_out`` | The most you can take by {mode} is {amount} / Nothing left to pay on this split / Nothing to give back by {type} |
| `errors.PAYMENT_REFERENCE_REQUIRED` | Enter the reference |
| `errors.PAYMENT_CASH_STEP` | Cash must be in steps of {amount} |
| `errors.DRAWER_DEVICE_INVALID` | This device can't hold a cash drawer |
| `errors.PETTY_SETTLE_MISMATCH` | Spent and returned must add up to {amount} |
| `errors.DAY_CLOSE_BLOCKED.unbilled_orders` | {count} orders are not billed — bill them or carry them over |
| `errors.DAY_CLOSE_BLOCKED.shift_open_one` | 1 shift is still open — close it first |
| `errors.DAY_CLOSE_BLOCKED.unbilled_orders_one` | 1 order is not billed — bill it or carry it over |
| `errors.PERMISSION_DENIED.not_own_payment/ `.skip_not_granted` / `.outside_scope`` | Only a manager can remove someone else's payment / You can't skip the count / This bill is not one of your tables |
| `billing.bill.load_failed` | Couldn't load the bill. |
| `billing.bill.offline` | Reconnecting to the hub… · Showing what we had as of {time} · every bill action needs the hub |
| `billing.bill.split` | Split {n} |
| `billing.bill.paid_split` | Paid · {invoice_ref} |
| `billing.state.closed` | Closed |
| `billing.state.reopened` | Reopened |
| `billing.tot.service_charge` | Service charge {rate} |
| `pad.all_paid` | All paid |
| `pad.all_paid_sub` | Add another payment only if the customer changes how they pay. |
| `pad.change_due_k` | Change due |
| `pad.change_after_add` | shows after Add payment — from the hub |
| `pad.enter_tendered` | Type the cash given, or leave it empty |
| `billing.blocks.buyer_id_required` | Buyer details needed above {threshold} |
| `billing.closed` | Closed · Invoice {invoice_ref} · {amount} |
| `billing.closed_empty` | Closed · nothing billed · money given back |
| `billing.done` | Done |
| `billing.tot.total` | Total |
| `billing.tot.paid` | Paid |
| `billing.dues.balance_k` | Balance |
| `billing.dues.nothing_left` | Nothing left to take — close the bill |
| `billing.refund.cash_k` | Refund cash |
| `billing.refund.card_k` | Refund card |
| `billing.blocks.refund_due` | Give back {amount} first |
| `billing.bill.split_closed` | Split {n} · Closed |
| `billing.bill.split_open` | Split {n} · Open |
| `billing.tag.new` | New |
| `billing.close_split` | Close split {n} |
| `billing.close_issues` | {amount} · issues the invoice |
| `billing.give_change` | Give change {amount} |
| `pad.tendered_short` | Cash given is less than the amount |
| `pad.offline_sub` | Payments, Close and every bill sheet wait for the hub. Nothing is queued — money is never taken offline. |
| `billing.tot.paid_k` | Paid · {type} |
| `billing.tot.paid_cash` | cash |
| `billing.tot.paid_card` | card |
| `pad.maybe_in` | This payment may already be in — check the payments before taking it again |
| `errors.PERMISSION_DENIED.not_requester` | Only the person who asked can withdraw it |
| `billing.print.title_check` | Print the check bill on… |
| `billing.print.title_receipt` | Print the receipt on… |
| `billing.print.title_credit` | Print the credit note on… |
| `billing.print.note` | It moves to the printer you pick. Nothing prints twice. |
| `billing.print.pick` | Pick a printer |
| `billing.print.print_on` | Print on {printer} |
| `billing.print.moved` | Moved to {printer} |
| `billing.print.failed_here` | didn’t print here · {error} |
| `billing.print.failed_here_plain` | didn’t print here |
| `billing.print.waiting_here` | waiting here |
| `billing.print.reprint_sent` | Reprint sent to {printer} |
| `billing.print.err.printer_gone` | This printer was removed — pick another |
| `billing.print.err.job_gone` | This print is no longer there |
| `billing.buyer.enter_name` | Type the name |
| `billing.buyer.pick_type` | Pick an ID type |
| `billing.buyer.enter_number` | Type the ID number |
| `billing.buyer.check_number` | Check the ID number |
| `billing.buyer.waiting_line` | Close without buyer details |
| `billing.buyer.needed_sub` | Name and ID. Sent with Close, never kept on screen. |
| `billing.buyer.add` | Add buyer |
| `billing.buyer.not_needed` | Not needed for this bill |
| `billing.buyer.not_needed_sub` | The total fell under the threshold. |
| `billing.buyer.waived_sub` | Holds for every later split and after a reopen. |
| `billing.buyer.change` | Change |
| `billing.shift.retry` | Try again |
| `billing.shift.someone` | someone |
| `billing.shift.day_not_open` | The day isn't started — ask a manager to start it |
| `billing.shift.opened_drawer` | Shift open · drawer opened |
| `billing.shift.opened` | Shift open |
| `billing.shift.open_title` | Open your shift |
| `billing.shift.open_note` | Count the starting cash you put in the drawer. 0 is fine. |
| `billing.shift.open_note_phone` | You close your own tables, so the money you take needs a shift. You have no drawer — start at 0 unless you carry change. |
| `billing.shift.float` | Starting cash |
| `billing.shift.use_drawer` | Use this device’s cash drawer |
| `billing.shift.use_drawer_sub` | The drawer opens when the starting cash is more than 0 |
| `billing.shift.go_to_mine` | Go to my shift |
| `billing.shift.open` | Open shift |
| `billing.shift.why_title` | Why first? |
| `billing.shift.why` | Every payment you take lands in your shift. At the end you count the cash once, before you see what was expected. |
| `billing.shift.other` | {name}'s shift |
| `billing.shift.state_closed` | Closed |
| `billing.shift.drawer` | Cash drawer |
| `billing.shift.payments_one` | 1 payment |
| `billing.shift.petty_in` | Cash in · {category} |
| `billing.shift.advance_settled` | Advance · {name} · settled |
| `billing.shift.handovers` | Handover counts today |
| `billing.shift.handover_row` | Handover count |
| `billing.shift.expected_was` | expected {amount} |
| `billing.shift.handover_title` | Count at handover |
| `billing.shift.handover_note` | Count now when someone takes over the drawer — the shift stays open. |
| `billing.shift.counted_now` | Cash counted now |
| `billing.shift.count` | Count |
| `billing.shift.skip_title` | Close without counting? |
| `billing.shift.skip_what` | The shift closes with no count and no variance. It shows as skipped on the Z report. Only people allowed to skip see this. |
| `billing.shift.skip_back` | Back to the count |
| `billing.shift.note_ph` | Note (optional) |
| `billing.shift.skipped` | Shift closed without a count |
| `billing.shift.expected` | Expected |
| `billing.shift.counted_k` | Counted |
| `billing.shift.variance` | Variance |
| `billing.shift.short` | Short {amount} |
| `billing.shift.over` | Over {amount} |
| `billing.shift.exact` | Exact |
| `billing.shift.closed_drawer` | Shift closed · drawer is free |
| `billing.shift.closed` | Shift closed |
| `billing.shift.signoff` | Variance sent for sign-off (pending); the drawer is free |
| `billing.shift.signoff_short` | More than {threshold} short — a manager signs it off later. You can go. |
| `billing.shift.signoff_over` | More than {threshold} over — a manager signs it off later. You can go. |
| `billing.shift.within` | Within the {threshold} threshold — nothing sent. |
| `billing.shift.handover_over` | Over the {threshold} threshold — a handover sends no sign-off; the close count does. |
| `billing.shift.petty_cancelled_one` | 1 petty cash request was cancelled because the shift closed |
| `billing.shift.petty_cancelled` | {count} petty cash requests were cancelled because the shift closed |
| `billing.shift.handed` | Handover counted · shift still open |
| `billing.shift.back` | Back to my shift |
| `billing.shift.not_counted` | Closed without a count |
