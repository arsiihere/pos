import { renderText, type Doc, type DocBlock } from '@pos/domain';
import type { BillingDocument, Jurisdiction } from '../../../api/cloud-admin';
import { shownRupees } from '../money';

// 01a v2.7.1 §8.1 (05 row A-1 (6), P-4): the receipt preview. A sample bill is laid out from the settings being
// edited and the jurisdiction's receipt labels, and rendered with `renderText` (the printer's own wrapping), so
// what the owner sees is the text a printer would get. No secret and no buyer ID is on it (B22).
export type PreviewWidth = 32 | 48;

type Rule = Jurisdiction['rules'][number];
export type ReceiptFiscalLabels = NonNullable<Rule['receipt_fiscal']>;

// The rule in force today: the latest effective_from not after `today` (ISO date), else the earliest.
export function currentRule(jurisdiction: Jurisdiction | undefined, today: string): Rule | undefined {
  const rules = [...(jurisdiction?.rules ?? [])].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  return [...rules].reverse().find((r) => r.effective_from <= today) ?? rules[0];
}

function row(left: string, right: string, cols: number): string {
  const gap = Math.max(1, cols - left.length - right.length);
  return `${left}${' '.repeat(gap)}${right}`;
}

export interface PreviewInput {
  receipt: BillingDocument['receipt'];
  dineInServiceBp: number;
  fiscal: ReceiptFiscalLabels | null;
}

const SAMPLE_UNIT_MINOR = 50_000;
const SAMPLE_QTY = 2;

export function receiptDoc(input: PreviewInput, cols: PreviewWidth): Doc {
  const { receipt, fiscal } = input;
  const blocks: DocBlock[] = [];
  const center = (text: string, bold = false): void => void blocks.push({ text, align: 'center', bold });
  for (const line of receipt.header_lines) center(line, true);
  if (receipt.show.address && receipt.address) center(receipt.address);
  if (receipt.show.phone && receipt.phone) center(receipt.phone);
  if (receipt.show.tax_reg_no) {
    for (const reg of receipt.tax_registrations) {
      const label = fiscal?.tax_reg_labels.find((l) => l.code === reg.code)?.label ?? reg.code;
      center(`${label}: ${reg.number}`);
    }
  }
  blocks.push({ rule: true });
  if (receipt.show.bill_no) blocks.push({ text: `Bill: ${receipt.invoice_prefix}0001` });
  if (receipt.show.order_no) blocks.push({ text: 'Order: 12' });
  if (receipt.show.cashier) blocks.push({ text: 'Cashier: Sample' });
  blocks.push({ rule: true });
  const subtotal = SAMPLE_UNIT_MINOR * SAMPLE_QTY;
  blocks.push({ text: row(`${SAMPLE_QTY} x Sample dish`, shownRupees(subtotal), cols) });
  let total = subtotal;
  if (input.dineInServiceBp > 0) {
    const charge = Math.round((subtotal * input.dineInServiceBp) / 10_000);
    total += charge;
    blocks.push({ text: row(`Service charge ${input.dineInServiceBp / 100}%`, shownRupees(charge), cols) });
  }
  blocks.push({ text: row('Total', shownRupees(total), cols), bold: true });
  if (fiscal !== null) {
    blocks.push({ rule: true });
    center(`${fiscal.fiscal_number_label}: 000000`);
    if (fiscal.show_qr) center('[QR]');
  }
  if (receipt.footer_lines.length > 0) blocks.push({ rule: true });
  for (const line of receipt.footer_lines) center(line);
  return { blocks };
}

export function previewText(input: PreviewInput, cols: PreviewWidth): string {
  return renderText(receiptDoc(input, cols), cols);
}
