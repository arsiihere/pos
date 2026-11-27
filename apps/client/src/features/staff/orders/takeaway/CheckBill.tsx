import { useEffect, useMemo, useRef, useState } from 'react';
import type { HubError } from '../../../../api/hub-admin';
import { t, type MessageKey } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { billingApi } from '../../../billing/api';
import type { BillView, Totals } from '../../../billing/contracts';
import { billingErrorKey } from '../../../billing/errors';
import { BIco } from '../../../billing/icons';
import { useShell, type Shell } from '../../shell/hooks';
import type { EtaDraft } from '../contracts';
import { money } from '../money';
import './styles';

// 02b-TK C3-2 (05 v1.0.34 §6.3, §3.16; ruling R6): "Print check bill" on the token view and on the cart of an addition
// to a sent token — `PrintCheckBill { bill_ref: { order_id } }` of the token's newest order (05 #44e). The check bill
// prints on the device's route (takeaway, §3.16); with no bill printer the command still succeeds (`printed: false`)
// and the screen says to show it. A resend after a lost reply keeps its command_id (billing api), so a check bill
// prints once.
// ⚠️ 02b-TK L-CLIENT-3 item 1 (05 v1.0.35 §6.3, §6.3a, §8; 02b v1.0.25 §8 OR-5 / R6; D9; 05 #60h): a cart with unsent
// lines (a plain takeaway / parking cart, or an addition cart with `adds_to_order_id`) prints through
// `PrintCartCheckBill { draft }` — never PrintCheckBill while unsent lines exist; it is not queueable (never in the
// QueueStore), off while offline and on a parking cart without a car number. Both results show the paper's gross
// (`totals_default.total_minor`) and remaining payable (`due_minor`). A paid token's action is "Print receipt again"
// (`PrintBillDocument { receipt }`, take-payment only).

/** A PrintCheckBill refusal's text (05 §6.3 errors as the takeaway meets them); never a raw code. */
export function checkBillText(e: HubError): string {
  if (e.kind !== 'api') return t('tables.toast.needs_hub');
  switch (e.code) {
    case 'ORDER_NOT_FOUND':
      return t('line.err.gone');
    case 'BUSINESS_DAY_NOT_OPEN':
      return t('v.check_day');
    case 'PERMISSION_DENIED':
      return t('v.check_denied');
    default:
      return t(billingErrorKey(e.code, e.details));
  }
}

/** 05 §6.3a line refusals (02b §9 codes), each with `details.key` = the refused draft line's key. */
const LINE_REFUSALS = new Set(['MENU_ITEM_NOT_FOUND', 'DEAL_NOT_FOUND', 'ITEM_UNAVAILABLE', 'ITEM_OUT_OF_HOURS', 'OPTION_CHOICE_INVALID']);

export interface CartNames {
  items: ReadonlyArray<{ item_id: string; name: string }>;
  deals: ReadonlyArray<{ deal_id: string; name: string }>;
  lines: ReadonlyArray<{ key: string; item_id?: string | undefined; deal_id?: string | undefined }>;
}

/** The refused line's key (05 §6.3a `details.key`), or null. */
export function refusedKey(e: HubError): string | null {
  if (e.kind !== 'api' || !LINE_REFUSALS.has(e.code)) return null;
  const key = e.details['key'];
  return typeof key === 'string' ? key : null;
}

/** A PrintCartCheckBill refusal's text (05 §6.3a Errors, the addition guards of R3-M-2); never a raw code. */
export function cartCheckBillText(e: HubError, names: CartNames): string {
  if (e.kind !== 'api') return t('tables.toast.needs_hub');
  if (e.code === 'ORDER_NOT_FOUND' || (e.code === 'CONFIG_REFERENCE_INVALID' && e.details['field'] === 'adds_to_order_id')) return t('c.add_gone');
  if (LINE_REFUSALS.has(e.code)) {
    const d = e.details as { item_id?: unknown; deal_id?: unknown; key?: unknown };
    const line = typeof d.key === 'string' ? names.lines.find((l) => l.key === d.key) : undefined;
    const item_id = typeof d.item_id === 'string' ? d.item_id : line?.item_id;
    const deal_id = typeof d.deal_id === 'string' ? d.deal_id : line?.deal_id;
    const item = (item_id === undefined ? undefined : names.items.find((i) => i.item_id === item_id)?.name) ?? (deal_id === undefined ? undefined : names.deals.find((x) => x.deal_id === deal_id)?.name) ?? t('send.an_item');
    return fill(t('billing.check_not_printed'), { why: fill(t(`queue.why.${e.code}` as MessageKey), { item }) });
  }
  if (e.code === 'VALIDATION_FAILED') return t('errors.VALIDATION_FAILED');
  return checkBillText(e);
}

/** "Check bill sent to Counter · Gross total Rs 700 · Remaining payable Rs 600" (or "No bill printer…"). */
function printedToast(shell: Shell, r: { printed: boolean; printer_name: string | null; totals_default?: Totals | undefined; due_minor?: number | undefined }): void {
  const head = r.printed ? fill(t('billing.check_sent'), { printer: r.printer_name ?? '' }) : t('billing.no_printer');
  const amounts = r.totals_default === undefined || r.due_minor === undefined ? '' : ` · ${fill(t('billing.check_amounts'), { gross: money(r.totals_default.total_minor), due: money(r.due_minor) })}`;
  shell.toasts.show({ text: head + amounts, tone: r.printed ? 'ok' : 'warn' });
}

/** One request in flight; the button greyed while it runs, offline, or when `off`. */
function usePrint(off: boolean) {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const disabled = busy || off || !shell.online;
  const run = async (body: () => Promise<void>) => {
    if (inFlight.current || off || !shell.online) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await body();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { shell, api, disabled, run };
}

export function CheckBill({ order_id }: { order_id: string }) {
  const { shell, api, disabled, run } = usePrint(false);
  const print = () =>
    run(async () => {
      const answer = await api.printCheckBill({ bill_ref: { order_id } });
      if (!answer.ok) return shell.toasts.show({ text: checkBillText(answer.error), tone: 'warn' });
      printedToast(shell, answer.data);
    });
  return (
    <button type="button" className="tk-btn" aria-disabled={disabled} onClick={() => void print()}>
      <BIco name="printer" />
      {t('billing.check_bill')}
    </button>
  );
}

export type CartCheckDraft = EtaDraft & { adds_to_order_id?: string };

/** ⚠️ 05 §6.3a: the cart's Print check bill before Send (`PrintCartCheckBill { draft }`); `onLine` gets a refused line's key. */
export function CartCheckBill({ draft, names, off = false, onLine }: { draft: CartCheckDraft; names: CartNames; off?: boolean; onLine?: (key: string) => void }) {
  const { shell, api, disabled, run } = usePrint(off);
  const print = () =>
    run(async () => {
      const answer = await api.printCartCheckBill({ draft });
      if (!answer.ok) {
        const key = refusedKey(answer.error);
        if (key !== null) onLine?.(key);
        return shell.toasts.show({ text: cartCheckBillText(answer.error, names), tone: 'warn' });
      }
      printedToast(shell, answer.data);
    });
  return (
    <button type="button" className="tk-btn" aria-disabled={disabled} onClick={() => void print()}>
      <BIco name="printer" />
      {t('billing.check_bill')}
    </button>
  );
}

/** The receipt to reprint of a paid bill: its newest closed split's invoice (05 v1.0.29 R-90), or null. */
export function receiptOf(b: Pick<BillView, 'splits'>): string | null {
  const closed = b.splits.filter((s) => s.state === 'closed' && s.invoice != null).sort((x, y) => y.split_no - x.split_no);
  return closed[0]?.invoice?.invoice_id ?? null;
}

/**
 * ⚠️ 05 §8 (OR-5), §6.22: "Print receipt again" on a paid token (`take-payment`; the caller checks). With no invoice
 * known yet, the tap reads `bill?order_id=` of the token's newest order first (the addition cart's case).
 */
export function ReceiptAgain({ order_id, invoice_id }: { order_id: string; invoice_id?: string | null }) {
  const { shell, api, disabled, run } = usePrint(false);
  const print = () =>
    run(async () => {
      let ref = invoice_id ?? null;
      if (ref === null) {
        const bill = await api.bill({ order_id });
        if (!bill.ok) return shell.toasts.show({ text: checkBillText(bill.error), tone: 'warn' });
        ref = receiptOf(bill.data);
        if (ref === null) return shell.toasts.show({ text: t('errors.INVOICE_NOT_FOUND'), tone: 'warn' });
      }
      const answer = await api.printBillDocument({ doc: 'receipt', ref_id: ref });
      if (!answer.ok) return shell.toasts.show({ text: answer.error.kind === 'api' ? t(billingErrorKey(answer.error.code, answer.error.details)) : t('tables.toast.needs_hub'), tone: 'warn' });
      const { printed, printer_name } = answer.data;
      shell.toasts.show(printed ? { text: fill(t('billing.print.reprint_sent'), { printer: printer_name ?? '' }), tone: 'ok' } : { text: t('billing.no_printer'), tone: 'warn' });
    });
  return (
    <button type="button" className="tk-btn" aria-disabled={disabled} onClick={() => void print()}>
      <BIco name="printer" />
      {t('billing.receipt_again')}
    </button>
  );
}

/**
 * The cart of an addition to a sent token, before any unsent line (05 §6.3 R2-m-4): the token's newest bill decides —
 * money due → Print check bill; paid → Print receipt again (take-payment only); one read when it is shown.
 */
export function SentTokenPrint({ order_id }: { order_id: string }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const [paid, setPaid] = useState<{ invoice_id: string | null } | false | null>(null);
  useEffect(() => {
    let live = true;
    void billingApi(shellRef.current.api)
      .bill({ order_id })
      .then((r) => {
        if (live) setPaid(r.ok && r.data.state === 'closed' ? { invoice_id: receiptOf(r.data) } : false);
      });
    return () => {
      live = false;
    };
  }, [order_id]);
  if (paid === null) return null;
  if (paid === false) return shell.permissions.allowed('take-order') ? <CheckBill order_id={order_id} /> : null;
  return shell.permissions.allowed('take-payment') ? <ReceiptAgain order_id={order_id} invoice_id={paid.invoice_id} /> : null;
}
