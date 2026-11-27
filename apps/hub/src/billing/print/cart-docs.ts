// ⚠️ 05 v1.0.35 §6.3a `buildCartCheckBillDoc` (OR-5; hostile run 2 R2-M-6, R2-m-8; run 3 R3-M-1): the paper check bill of
// an unsent (or addition) takeaway / parking cart, built from the check bill's own Doc (§6.3, PC437, no Urdu) so the
// figures and layout stay one: first line `NOT SENT YET - CHECK BILL`, on an addition `Includes items not sent yet`,
// then `PROVISIONAL - NOT A TAX INVOICE`, the branch header, the printed-at line, the lines (a weighed line with no
// weight: its name and "weighed at the counter", no amount), the totals, the gross total (`Total (+ weighed items)`
// with such a line), "total if paid in cash" / by card, and "Already paid" / "Remaining payable" once something is
// paid. No token, no bill or invoice number, no QR, no customer name or phone. Pure.
import { buildCheckBillDoc, formatMinor, type CheckBillDocInput, type Doc, type DocBlock } from '@pos/domain';
import type { CheckBill } from '../commands/print-check-bill.js';

export const CART_HEADING = 'NOT SENT YET - CHECK BILL';
export const ADDITION_NOTE = 'Includes items not sent yet';
export const WEIGHED_NOTE = 'weighed at the counter';
const PROVISIONAL = 'PROVISIONAL - NOT A TAX INVOICE';

export interface CartDocInput {
  check: Pick<CheckBill, 'doc_input' | 'doc_money'>;
  printed_at: number;
  /** the draft's weighed lines with no weight yet (names, draft order) */
  weighed: readonly string[];
  /** an addition cart printed as one combined paper with the token's sent lines */
  addition: boolean;
}

function spread(left: string, right: string, cols: number, bold: boolean): DocBlock[] {
  const b = bold ? { bold: true } : {};
  if (left.length + 1 + right.length <= cols) return [{ text: left + ' '.repeat(cols - left.length - right.length) + right, ...b }];
  return [{ text: left, ...b }, { text: right, ...b, align: 'right' }];
}

const textOf = (b: DocBlock): string | null => ('text' in b ? b.text : null);

export function buildCartCheckBillDoc(o: CartDocInput, ctx: { width_cols: 32 | 48; utc_offset_ms: number; branch_name: string }): Doc {
  const input: CheckBillDocInput = { ...o.check.doc_input, identifier: 'Printed at', printed_at: o.printed_at };
  const base = buildCheckBillDoc(input, { ...ctx, ...o.check.doc_money });
  const blocks = base.blocks;
  const p = blocks.findIndex((b) => textOf(b) === PROVISIONAL);
  if (p < 0) throw new RangeError('cart check bill: no provisional line');
  // the check bill: owner header, PROVISIONAL, printed-at, rule, lines, rule, totals …
  const rules = blocks.map((b, i) => ('rule' in b ? i : -1)).filter((i) => i > p);
  const endOfLines = rules[1];
  const cash = blocks.findIndex((b) => textOf(b)?.startsWith('Total if paid in cash') === true);
  if (endOfLines === undefined || cash < 0) throw new RangeError('cart check bill: unexpected check bill layout');
  const weighedBlocks: DocBlock[] = o.weighed.flatMap((name) => [{ text: name }, { text: `  ${WEIGHED_NOTE}` }]);
  const total = spread(o.weighed.length > 0 ? 'Total (+ weighed items)' : 'Gross total', formatMinor(input.cash_total_minor, o.check.doc_money.currency_exponent), ctx.width_cols, true);
  const out: DocBlock[] = [
    { text: CART_HEADING, align: 'center', bold: true },
    ...(o.addition ? [{ text: ADDITION_NOTE, align: 'center' } as DocBlock] : []),
    blocks[p]!,
    ...blocks.slice(0, p),
    ...blocks.slice(p + 1, endOfLines),
    ...weighedBlocks,
    ...blocks.slice(endOfLines, cash),
    ...total,
    ...blocks.slice(cash),
  ];
  return { ...base, blocks: out };
}
