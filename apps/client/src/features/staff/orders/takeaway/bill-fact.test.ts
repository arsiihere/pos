import { describe, expect, it } from 'vitest';
import type { BillView, BillViewSplit } from '../../../billing/contracts';
import { billFact } from './TokenView';

// "Paid · Rs 0" on a paid token (L-CLIENT-3 e2e capture). Root cause: billFact took a CLOSED bill's amount from
// `totals_default.total_minor`, which is the OPEN remainder's total (05 §6.1; apps/hub/src/billing/queries/bill.ts:
// `result === null ? ZERO_TOTALS`), so it is 0 once every split has closed. A paid bill's amount is what its closed
// splits invoiced: Σ their totals (a closed split's totals are its current invoice's, §6.1).

const zero = { subtotal_minor: 0, discount_minor: 0, service_charge_minor: 0, taxes: [], rounding_minor: 0, total_minor: 0 };
const totals = (total_minor: number) => ({ ...zero, subtotal_minor: total_minor, total_minor });
const closed = (split_no: number, total_minor: number): BillViewSplit => ({
  split_no,
  state: 'closed',
  plan: null,
  payments: [],
  totals: { cash: totals(total_minor), digital: totals(total_minor), as_paid: totals(total_minor) },
  balance_minor: 0,
  invoice: { invoice_id: `INV${split_no}`, invoice_ref: `S00000${split_no}`, fiscal_number: null, fiscal_state: null },
});
const bill = (over: Partial<BillView>): BillView => ({ bill_id: 'B1', state: 'closed', splits: [], totals_default: zero, ...over }) as unknown as BillView;

describe('[05 §6.1; 02b-TK token view] billFact of a paid (closed) bill', () => {
  it('one closed split: the amount is its invoice total, not the open remainder (0)', () => {
    expect(billFact(bill({ splits: [closed(1, 119_000)] }))).toMatchObject({ paid: true, amount_minor: 119_000, bill_id: 'B1' });
  });
  it('two closed splits: the amount is Σ their invoice totals; the receipt to print again is the newest invoice', () => {
    expect(billFact(bill({ splits: [closed(1, 50_000), closed(2, 69_000)] }))).toMatchObject({ paid: true, amount_minor: 119_000, invoice_id: 'INV2' });
  });
});
