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
| `billing.reopen_mode.full/ `.corrections`` | Full edit: add, remove or change items / Corrections only: remove, void or comp; new items go on a new bill |
| `billing.buyer.needed/ `.added` / `.waived`` | Buyer details needed above {threshold} / Buyer added — sent with Close / Customer refused buyer details |
| `billing.read_only` | Total if paid in cash {cash} · By card {card} |
| `billing.reprint_receipt/ `.reprint_credit`` | Reprint receipt / Reprint credit note |
| `billing.print.waiting/ `.printed` / `.failed` / `.none` / `.print_to`` | Printing on {printer}… / Printed on {printer} / Didn't print on {printer}: {error} / No bill printer set up / Print to |
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
| `errors.DAY_CLOSE_BLOCKED.variance_pending/ `_one`` | {count} variance sign-offs are still pending — answer them first / 1 variance sign-off is still pending — answer it first |
| `admin_stock.errors.DAY_CLOSE_BLOCKED_variance_pending/ `_one`` | {count} variance sign-offs are still pending — answer them first / 1 variance sign-off is still pending — answer it first |
| `errors.PERMISSION_DENIED.not_own_payment/ `.skip_not_granted` / `.outside_scope`` | Only a manager can remove someone else's payment / You can't skip the count / This bill is not one of your tables |
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
| `billing.shift.within` | Within the {threshold} threshold — nothing sent. |
| `billing.shift.petty_cancelled_one` | 1 petty cash request was cancelled because the shift closed |
| `billing.shift.petty_cancelled` | {count} petty cash requests were cancelled because the shift closed |
| `billing.shift.handed` | Handover counted · shift still open |
| `billing.shift.back` | Back to my shift |
| `billing.shift.not_counted` | Closed without a count |
| `billing.shift.not_counted_cash` | not counted |
| `billing.shift.nothing_sent` | Nothing sent for sign-off. |
| `billing.shift.signed_out` | You were signed out — sign in again |
| `billing.petty.from_shift` | From {name}'s shift |
| `billing.petty.who` | Who takes it |
| `billing.petty.enter_amount` | Type the amount |
| `billing.petty.pick_category` | Pick a category |
| `billing.petty.pick_person` | Pick who takes it |
| `billing.petty.recorded` | Recorded |
| `billing.petty.recorded_drawer` | Recorded · drawer opened |
| `billing.petty.waiting` | Waiting for a manager |
| `billing.petty.waiting_line` | {kind} {amount} · {category} · asked {time} |
| `billing.petty.when_approved` | When it is approved, open the drawer to take the cash. The drawer doesn’t open by itself. |
| `billing.petty.approved` | Approved — open the drawer to take the cash |
| `billing.petty.back` | Back |
| `billing.petty.settle` | Settle |
| `billing.petty.settle_title` | Settle advance |
| `billing.petty.spent` | Spent |
| `billing.petty.returned` | Returned (cash back) |
| `billing.petty.returned_note` | The returned cash goes into your shift. |
| `billing.petty.enter_spent` | Type what was spent |
| `billing.petty.enter_returned` | Type what came back |
| `billing.petty.settled` | Advance settled |
| `billing.petty.limit_over` | Over the {limit} limit — a manager approves it |
| `billing.petty.waiting_screen` | Petty cash waiting for a manager · {line} |
| `billing.petty.not_pending` | That request was already answered or closed — see your inbox |
| `billing.report.title` | Reports |
| `billing.report.tab_x` | Today (X) |
| `billing.report.tab_z` | Z reports |
| `billing.report.retry_done` | {count} waiting — sending now |
| `billing.report.bills_k` | Bills |
| `billing.report.invoices_n` | {count} invoices |
| `billing.report.invoices_one` | 1 invoice |
| `billing.report.per_bill` | sales ÷ bills (a split bill counts once) |
| `billing.report.x_line` | X · {date} · issued {time} · {currency} |
| `billing.report.z_line` | {z} · {date} · issued {time} · {currency} |
| `billing.report.z_no` | Z {no} |
| `billing.report.z_title` | Z reports |
| `billing.report.newest_first` | newest first |
| `billing.report.no_z` | No Z reports yet |
| `billing.report.z_row` | {count} invoices · closed {time} |
| `billing.report.net` | net |
| `billing.report.older` | Load older |
| `billing.report.net_after_credits` | Net after credits |
| `billing.report.so_far` | so far today |
| `billing.report.invoices` | Invoices |
| `billing.report.credit_notes_one` | 1 credit note |
| `billing.report.credit_notes` | {count} credit notes |
| `billing.report.average` | Average bill |
| `billing.report.bills_one` | 1 bill |
| `billing.report.bills` | {count} bills |
| `billing.report.fiscal` | Fiscal |
| `billing.report.kpi_rejected` | {count} not accepted |
| `billing.report.kpi_waiting` | {count} waiting |
| `billing.report.kpi_all_sent` | All sent |
| `billing.report.kpi_fiscal_sub` | {acked} accepted · {rejected} not accepted |
| `billing.report.sales` | Sales |
| `billing.report.gross` | Gross |
| `billing.report.discounts` | Discounts · {count} |
| `billing.report.service_charge` | Service charge |
| `billing.report.net_sales` | Net |
| `billing.report.class_cash` | cash |
| `billing.report.class_digital` | digital |
| `billing.report.rounding` | Rounding |
| `billing.report.total` | Total |
| `billing.report.credits` | Credits · {count} |
| `billing.report.credit_reason.wrong_item_billed` | Wrong item billed |
| `billing.report.credit_reason.wrong_payment_mode` | Wrong payment type |
| `billing.report.credit_reason.customer_returned_item` | Customer returned an item |
| `billing.report.credit_reason.price_error` | Price error |
| `billing.report.credit_reason.other` | Other |
| `billing.report.full_refunds` | Full refunds · {count} |
| `billing.report.payments` | Payments by mode |
| `billing.report.mode_in` | {mode} · in |
| `billing.report.mode_back` | {mode} · back |
| `billing.report.mode_change` | {mode} · change given |
| `billing.report.brought_forward` | Brought forward |
| `billing.report.carried_forward` | Carried forward |
| `billing.report.shifts` | Shifts |
| `billing.report.open` | Open |
| `billing.report.within` | Within |
| `billing.report.skipped` | Skipped |
| `billing.report.skipped_count` | skipped the count |
| `billing.report.shift_open` | float {float} · open |
| `billing.report.shift_counted` | expected {expected} · counted {counted} · {variance} |
| `billing.report.signoff_pending` | Pending sign-off |
| `billing.report.signoff_approved` | Approved |
| `billing.report.signoff_disputed` | Disputed |
| `billing.report.signoffs` | Variance sign-offs today |
| `billing.report.signed_approved` | Approved by {name} |
| `billing.report.signed_disputed` | Disputed by {name} |
| `billing.report.pending_signoffs` | Pending sign-offs |
| `billing.report.acked` | Accepted |
| `billing.report.pending` | Pending |
| `billing.report.rejected` | Not accepted |
| `billing.report.not_required` | Not required |
| `billing.report.retry` | Retry fiscal now |
| `billing.report.rejected_note` | Not accepted invoices need a fix from support |
| `billing.report.open_bills` | Open bills |
| `billing.report.open_now` | Open now |
| `billing.report.open_too_long` | Open too long |
| `billing.report.carried_in` | Carried in |
| `billing.report.carried_over` | Carried over |
| `billing.report.carried` | Carried orders |
| `billing.report.open_advances` | Open advances |
| `billing.report.cvr` | Comps, voids, reopens |
| `billing.report.comps` | Comps |
| `billing.report.comps_voided` | Voided comps |
| `billing.report.comp_removals` | Comp removals |
| `billing.report.voids` | Voids · {disposition} |
| `billing.report.void_none` | No disposition |
| `billing.report.reopens` | Reopens |
| `billing.report.by_direct` | {name} |
| `billing.report.by_approved` | asked {name}, approved {approver} |
| `billing.report.by_taker` | Takings by person |
| `billing.report.no_open_day` | No day is open, so there is no X. A closed day's figures are in its Z report. |
| `billing.report.see_z` | See Z reports |
| `billing.report.print` | Print |
| `billing.report.print_again` | Print again |
| `billing.report.printed` | Sent to {printer} |
| `billing.report.not_printed` | No printer is set up for reports — nothing printed |
| `billing.report.older_z` | Only the latest Z of a date prints |
| `billing.report.print_no_day` | No day is open, so there is no X to print. |
| `billing.pay_remove.button` | Remove |
| `billing.pay_remove.title` | Remove payment |
| `billing.pay_remove.why` | Why remove it |
| `billing.pay_remove.keep` | Keep it |
| `billing.pay_remove.ok` | OK |
| `billing.pay_remove.done` | Payment removed |
| `billing.pay_remove.maybe` | The hub didn’t answer — the payment may already be removed. Check the payments, then try again. |
| `billing.pay_remove.in` | In |
| `billing.pay_remove.out` | Back |
| `billing.pay_remove.shift_closed` | This payment’s shift is already counted — it can’t be removed. Give the money back from your shift instead: the pad offers Give back when the bill owes the customer. |
| `billing.pay_remove.reason.wrong_mode` | Wrong payment type |
| `billing.pay_remove.reason.wrong_amount` | Wrong amount |
| `billing.pay_remove.reason.customer_changed` | Customer changed their mind |
| `billing.pay_remove.reason.other` | Other |
| `billing.reopen.button` | Reopen |
| `billing.reopen.title` | Reopen bill |
| `billing.reopen.why` | Why reopen |
| `billing.reopen.invoices` | Invoice {refs} |
| `billing.reopen.what` | Each paid split gets a credit note. Payments stay. Close again to issue new invoices. |
| `billing.reopen.paid_splits` | Paid splits |
| `billing.reopen.credit_prints` | Credit note prints by itself |
| `billing.reopen.waiting_line` | Reopen bill · {reason} · asked {time} |
| `billing.reopen.waiting_what` | The credit note prints on the approver’s device route when it is approved. |
| `billing.reopen.not_closed` | Only a closed or partly paid bill can be reopened |
| `billing.reopen.done` | Reopened · credit {credits} |
| `billing.reopen.corrections` | Corrections only: remove, void or comp; new items go on a new bill |
| `billing.closed_k` | Closed |
| `billing.closed_invoice` | Invoice |
| `billing.closed_empty_line` | nothing billed · money given back |
| `billing.closed_fiscal_pending` | Fiscal number pending |
| `billing.done_next` | Done · next bill |
| `billing.comp_remove.reason.comped_by_mistake` | Comped by mistake |
| `billing.comp_remove.reason.wrong_line` | Wrong line |
| `billing.comp_remove.reason.other` | Other |
| `billing.dayclose.step_signoffs` | Pending sign-offs |
| `billing.dayclose.ready` | Ready when you are |
| `billing.dayclose.ready_note` | Tap Close day. If something is still open, it shows here as a list with a way to fix each row. |
| `billing.dayclose.not_open` | No day is open to close. |
| `billing.dayclose.opened_recently` | The day opened too recently to close; nothing changed. |
| `billing.dayclose.done` | Day closed |
| `billing.dayclose.done_z` | Day closed · {z} |
| `billing.dayclose.done_sub` | {date} · issued {time} |
| `billing.dayclose.no_z` | No Z report for this day (the branch has no billing settings yet). |
| `billing.dayclose.blocked_generic` | Something still stops the day from closing. Fix it, then tap Close day again. |
| `billing.dayclose.voids_sub` | Same list as the Stock page’s day close. |
| `billing.dayclose.void_row` | {item} · asked by {name} |
| `billing.dayclose.open_requests` | Open Requests |
| `billing.dayclose.signoffs_one` | 1 variance sign-off is still pending — answer it first |
| `billing.dayclose.signoffs` | {count} variance sign-offs are still pending — answer them first |
| `billing.dayclose.signoffs_sub` | Answer them in Requests; the day closes after. |
| `billing.dayclose.closed_at` | closed {time} |
| `billing.dayclose.all_carried` | Every listed order is carried over — tap Close day again |
| `billing.dayclose.ticked` | {count} ticked |
| `billing.dayclose.carry_n` | Carry over {count} |
| `billing.dayclose.tick` | Carry over {identifier} |
| `billing.dayclose.placed` | placed {time} · open {open} |
| `billing.dayclose.open_bill` | Open bill |
| `billing.dayclose.carried` | {count} orders carried over — tap Close day again |
| `billing.dayclose.carried_one` | 1 order carried over — tap Close day again |
| `billing.dayclose.carry_title` | Carry over to tomorrow |
| `billing.dayclose.orders` | {count} orders |
| `billing.dayclose.orders_one` | 1 order |
| `billing.dayclose.placed_short` | placed {time} |
| `billing.dayclose.why` | Why |
| `billing.dayclose.reason.table_still_seated` | Table still seated |
| `billing.dayclose.reason.customer_will_pay_later` | Customer will pay later |
| `billing.dayclose.reason.other` | Other |
| `billing.dayclose.carry_note` | They move to tomorrow and stay open. Any payment already taken shows as carried forward on the Z. |
| `billing.dayclose.carry_send` | Carry over {count} orders |
| `billing.dayclose.carry_send_one` | Carry over 1 order |
| `billing.dayclose.z_unread` | The Z is saved and printed. Open it in Reports to see it here. |
| `billing.dayclose.ask_manager` | Someone allowed to answer them does it in Requests. |
| `billing.dayclose.load_next` | The listed orders are carried over — tap Close day again for the next ones |
| `billing.dayclose.refresh` | Tap Close day again to refresh the list. |
| `billing.fiscal.waiting` | Fiscal: {count} waiting · oldest {age} |
| `billing.fiscal.stuck` | {waiting} — tell a manager |
| `billing.fiscal.rejected` | Fiscal: {count} not accepted — tell a manager |
| `billing.fiscal.not_set_up` | Fiscal: not set up on this hub — tell the owner |
| `billing.fiscal.failing` | Fiscal: can’t reach the authority |
| `billing.fiscal.unknown` | Fiscal: not checked yet |
| `billing.fiscal.all_sent` | Fiscal: all sent |
| `billing.fiscal.last` | last {time} |
| `billing.zprint.none` | Z not printed — print it from the Z screen |
| `billing.zprint.printing` | Z printing… |
| `billing.zprint.printing_on` | Z printing on {printer}… |
| `billing.zprint.failed` | Z printing… — printer problem on {printer} |
| `billing.zprint.failed_plain` | Z printing… — printer problem |
| `billing.zprint.printed` | Z printed on {printer} |
| `billing.zprint.printed_plain` | Z printed |
| `billing.zprint.refresh` | Refresh |

## Builder notes

- Task 39 (shift screens): the petty cash and advance rows show no time ("12:10 PM", "2 h ago" in ShiftClose / PettyAdvances). The hub contract §6.16 `petty[]` has no time field, and none is added (owner 2026-11-20).
