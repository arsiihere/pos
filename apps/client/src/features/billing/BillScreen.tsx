import { defaultBillingSettings } from '@pos/events';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { HubError } from '../../api/hub-admin';
import { t } from '../../i18n';
import { fill, type MessageKey } from '../../i18n/en';
import { timeText } from '../alerts/labels';
import { Ico } from '../alerts/ui';
import { useLiveRefetch } from '../staff/orders/lists/OpenOrders';
import { useShell } from '../staff/shell/hooks';
import { groupBillLines } from './parts';
import { billingApi } from './api';
import type { AddPaymentResult, BillBlock, BillRef, BillView, BillViewSplit, SplitDues, Totals } from './contracts';
import { BuyerSheet, canDiscount, DiscountSheet, RemovePaymentSheet, ReopenSheet, ServiceChargeRow, ServiceChargeSheet, type BuyerEntry, type BuyerIssue } from './BillSheets';
import { BIco } from './icons';
import { SplitEditor } from './SplitEditor';
import { CheckBillButton, PRINT_WATCH_MS, PRINT_WATCH_TRIES, PrintRows, ReprintButton } from './PrintStatus';
import { billingErrorKey } from './errors';
import { BILL_LIST_FRAMES } from './frames';
import { amountText, billMoney, currencySymbol, MONEY_DIR, parseMinor, rateText, signedAmountText } from './money';
import './styles';
import { MaskedAction } from '../staff/shell/MaskedAction';
import { REFERENCE_MAX, referenceLength, typedReference } from './reference';

// 05 v1.0.14 §8 "Bill screen", §6.1, §6.9, §6.12, §3.3, §3.5 (7) (plan §3.1 task 35; brief §3.2; frames Bill,
// BillPadCash, BillPadCard, BillMixed, BillCloseBlocked, BillReadyToClose, BillTotalChanged, BillClosed, BillRefund,
// BillOffline, BillUrdu). Lines with their tags; the totals table at both classes with the rounding adjustment on its
// own row; the cash / card dues side by side; the payment pad (a mode shows its class total before taking it, M-7;
// cash given is never pre-filled, M-6; change only from the AddPayment result); Close with the server's `blocks` text
// (R-29) and `expected_total_minor` (rule 7: BILL_TOTAL_CHANGED re-reads, never auto-closes). Totals, dues, rounding
// and change are the hub's — the client computes no tax and no money (G1-15). A retry after a lost reply resends the
// same command_id (handbook §10). E2E E-1: the split editor (36), the discount sheet and the service-charge row and
// sheet (37) are mounted here — Split and Discount on the acts row (frame Bill), Remove discount on the discount row,
// the service-charge row with Remove / Add back in the totals; each answer reads the bill again.

/** R-4: the gap left between Add payment and the Close bar when the pad opens (px). */
export const PAD_CLEAR_PX = 12;

export interface Mode {
  mode_id: string;
  name: string;
  kind: string;
  payment_class: 'cash' | 'digital';
  reference_required: boolean;
  is_active: boolean;
  sort_order: number;
}

/** The branch's active payment modes in sort order; with no `billing` key, the hub's built-in defaults. */
const DEFAULT_MODES: readonly Mode[] = defaultBillingSettings({ currency_code: 'PKR', currency_exponent: 2 }).payment_modes;
// cached by content, so the store read is stable between renders whatever object the snapshot is
let lastKey = '';
let lastModes: readonly Mode[] = [];
export function activeModes(snapshot: unknown): readonly Mode[] {
  const list = (snapshot as { billing?: { payment_modes?: Mode[] } } | null)?.billing?.payment_modes;
  const source = Array.isArray(list) ? list : DEFAULT_MODES;
  const key = JSON.stringify(source);
  if (key === lastKey) return lastModes;
  lastKey = key;
  lastModes = source.filter((m) => m.is_active).sort((a, b) => a.sort_order - b.sort_order);
  return lastModes;
}

/** §6 bill_ref from a `#/bill?…` query: exactly one of bill_id, seating_id, order_id; else null. */
export function billRefOfSearch(search: string): BillRef | null {
  const q = new URLSearchParams(search);
  const found = (['bill_id', 'seating_id', 'order_id'] as const).flatMap((k) => {
    const v = q.get(k);
    return v === null || v === '' ? [] : [[k, v] as const];
  });
  if (found.length !== 1) return null;
  const [k, v] = found[0]!;
  return k === 'bill_id' ? { bill_id: v } : k === 'seating_id' ? { seating_id: v } : { order_id: v };
}

/** The AddPayment result this screen holds for a split (its dues are valid while that payment is the split's last). */
export interface HeldResult extends SplitDues {
  split_no: number;
  payment_id: string;
  /** the split's balance and as-paid total the result was computed on: any later change (a round, a void, a reopen) makes the dues stale */
  balance_minor: number;
  total_minor: number;
}

/**
 * §3.5 (7) the split's four due fields. From the latest AddPayment result while its payment is still the split's last;
 * else, with no live payment, the two class totals (the hub's rule then reduces to them exactly); a split with no
 * money left (balance ≤ 0 and no payment, or balance 0) has none due. Otherwise null: the bill view carries no dues
 * (05 §6.1 gap — STOP to the owner in the PR), and the screen shows Paid · Left only.
 */
export function duesOf(split: BillViewSplit, held: HeldResult | null): SplitDues | null {
  const none: SplitDues = { card_due_minor: 0, cash_due_minor: 0, card_refund_due_minor: 0, cash_refund_due_minor: 0 };
  const last = split.payments[split.payments.length - 1];
  if (
    held !== null &&
    held.split_no === split.split_no &&
    last !== undefined &&
    last.payment_id === held.payment_id &&
    held.balance_minor === split.balance_minor &&
    held.total_minor === split.totals.as_paid.total_minor
  ) {
    return { card_due_minor: held.card_due_minor, cash_due_minor: held.cash_due_minor, card_refund_due_minor: held.card_refund_due_minor, cash_refund_due_minor: held.cash_refund_due_minor };
  }
  // ⚠️ 05 v1.0.37 §6.1 (R2-1): the hub's own dues of the view, when it sends them
  if (split.dues !== undefined) return split.dues;
  if (split.balance_minor === 0) return none;
  if (split.payments.length === 0) return split.balance_minor > 0 ? { ...none, card_due_minor: split.totals.digital.total_minor, cash_due_minor: split.totals.cash.total_minor } : none;
  return null;
}

const TAG: Record<string, MessageKey> = {
  comp: 'billing.tag.comp',
  pending_void: 'billing.tag.pending_void',
  weight_needed: 'billing.tag.weight_needed',
  tax_unresolved: 'billing.tag.tax_unresolved',
};

/**
 * "Paid · card" / "Paid · cash" / "Paid · cash + card" (frames BillMixed, BillReadyToClose): the classes of the live
 * payments, by their mode in the branch settings; a mode no longer listed reads plain "Paid".
 */
function paidLabel(split: BillViewSplit, modes: readonly Mode[]): string {
  const classes = new Set(split.payments.map((p) => modes.find((m) => m.mode_id === p.mode_id)?.payment_class ?? null));
  if (classes.has(null) || classes.size === 0) return t('billing.tot.paid');
  const type = [...classes].sort().map((c) => t(c === 'cash' ? 'billing.tot.paid_cash' : 'billing.tot.paid_card')).join(' + ');
  return fill(t('billing.tot.paid_k'), { type });
}

/** The frames' tag looks: COMP and New as `b5-tg`, PENDING VOID as 04's `vptag`, the two close blockers toned. */
const TAG_CLASS: Record<string, string> = {
  comp: 'b5-tg comp',
  pending_void: 'vptag',
  weight_needed: 'b5-tg c-warn',
  tax_unresolved: 'b5-tg c-danger',
};

function TotalsTable({
  split,
  bill,
  paid,
  modes,
  billRef,
  onRemoveDiscount,
  onRemoveCharge,
  onChanged,
  online,
}: {
  split: BillViewSplit;
  bill: BillView;
  paid: number;
  modes: readonly Mode[];
  billRef: BillRef;
  /** E-1: the discount row's Remove discount (null: not offered) */
  onRemoveDiscount: (() => void) | null;
  onRemoveCharge: () => void;
  onChanged: () => void;
  online: boolean;
}) {
  const code = bill.currency.code;
  const cash = split.totals.cash;
  const card = split.totals.digital;
  const amt = (m: number) => amountText(m, code);
  // one row per (profile, tax code), the cash and the card figure side by side
  const keys = [...new Map([...cash.taxes, ...card.taxes].map((x) => [`${x.tax_profile_id}|${x.tax_code}`, x.label] as const))];
  const cell = (tot: Totals, k: string) => {
    const x = tot.taxes.find((y) => `${y.tax_profile_id}|${y.tax_code}` === k);
    return x === undefined ? '—' : `${rateText(x.rate_bp)} · ${amt(x.tax_minor)}`;
  };
  return (
    <section className="b5-tot">
      <div className="b5-tr hd">
        <span>{t('billing.tot.head')}</span>
        <span className="v">{t('billing.tot.if_cash')}</span>
        <span className="v">{t('billing.tot.by_card')}</span>
      </div>
      <div className="b5-tr">
        <span>{t('billing.tot.subtotal')}</span>
        <span className="v sp">{amt(cash.subtotal_minor)}</span>
      </div>
      {cash.discount_minor > 0 && (
        <div className="b5-tr disc">
          <span>
            {t('billing.tot.discount')}
            {onRemoveDiscount !== null && (
              <button type="button" className="btn" onClick={onRemoveDiscount}>
                {t('billing.discount.remove')}
              </button>
            )}
          </span>
          <span className="v sp">{amt(-cash.discount_minor)}</span>
        </div>
      )}
      {/* B8 / §6.8: the sticky service charge row (Remove / Add back), this split's amount */}
      {bill.service_charge.rate_bp > 0 && (
        <ServiceChargeRow bill={bill} billRef={billRef} amountMinor={cash.service_charge_minor} readOnly={!online || split.state === 'closed'} onRemove={onRemoveCharge} onChanged={onChanged} />
      )}
      {keys.map(([k, label]) => (
        <div key={k} className="b5-tr">
          <span>{label}</span>
          <span className="v">{cell(cash, k)}</span>
          <span className="v">{cell(card, k)}</span>
        </div>
      ))}
      {(cash.rounding_minor !== 0 || card.rounding_minor !== 0) && (
        <div className="b5-tr rnd">
          <span>{t('billing.tot.rounding')}</span>
          <span className="v">{signedAmountText(cash.rounding_minor, code)}</span>
          <span className="v">{signedAmountText(card.rounding_minor, code)}</span>
        </div>
      )}
      <div className="b5-tr sum">
        <span>{t('billing.tot.total')}</span>
        <span className="v">{amt(cash.total_minor)}</span>
        <span className="v">{amt(card.total_minor)}</span>
      </div>
      {split.payments.length > 0 && (
        <div className="b5-tr paid">
          <span>{paidLabel(split, modes)}</span>
          <span className="v sp">{amt(paid)}</span>
        </div>
      )}
    </section>
  );
}

function blockText(b: BillBlock, bill: BillView, split: BillViewSplit, dues: SplitDues | null): string {
  const code = bill.currency.code;
  const nameOf = (id: string) => bill.lines.find((l) => l.order_item_id === id)?.name ?? '';
  const ids = Array.isArray(b.details['order_item_ids']) ? (b.details['order_item_ids'] as string[]) : [];
  const items = (list: string[]) => ({ n: String(list.length), items: list.map(nameOf).filter((x) => x !== '').join(', ') });
  switch (b.reason) {
    case 'void_pending':
      return fill(t('billing.blocks.void_pending'), items(ids));
    case 'weight_pending':
      return fill(t('billing.blocks.weight_pending'), items(ids));
    case 'tax_unresolved': {
      const lines = ids.filter((id) => id !== 'service_charge');
      return lines.length === 0 ? t('billing.blocks.tax_unresolved_sc') : fill(t('billing.blocks.tax_unresolved'), items(lines));
    }
    case 'buyer_id_required':
      return fill(t('billing.blocks.buyer_id_required'), { threshold: typeof b.details['threshold_minor'] === 'number' ? billMoney(b.details['threshold_minor'], code) : '' });
    case 'balance_due':
      if (split.balance_minor < 0) return fill(t('billing.blocks.refund_due'), { amount: billMoney(-split.balance_minor, code) });
      return dues !== null && split.balance_minor > 0
        ? fill(t('billing.blocks.balance_due'), { cash: billMoney(dues.cash_due_minor, code), card: billMoney(dues.card_due_minor, code) })
        : fill(t('errors.BILL_BALANCE_DUE'), { amount: billMoney(split.balance_minor, code), n: String(split.split_no) });
    case 'bill_not_open':
    case 'discount_pending':
    case 'shares_sum':
      return t(`billing.blocks.${b.reason}` as MessageKey);
    default:
      return t('errors.UNKNOWN');
  }
}

/**
 * A pad or close refusal's text, filled from the hub's figures (§9 `details`), the mode's name (the picked mode, or
 * the one `details.mode_id` names) and, for BILL_CLOSE_BLOCKED, the block line of its reason. Never a raw `{…}`.
 */
export function refusalText(e: HubError, ctx: { bill: BillView; split: BillViewSplit; dues: SplitDues | null; mode: Mode | null; modes: readonly Mode[]; direction: 'in' | 'out' }): string {
  if (e.kind !== 'api') return t('tables.toast.needs_hub');
  const d = e.details;
  const code = ctx.bill.currency.code;
  const money = (k: string) => (Number.isSafeInteger(d[k]) ? billMoney(d[k] as number, code) : '');
  if (e.code === 'BILL_CLOSE_BLOCKED' && typeof d['reason'] === 'string')
    return fill(t('errors.BILL_CLOSE_BLOCKED'), { reasons: blockText({ reason: d['reason'], split_no: ctx.split.split_no, details: d }, ctx.bill, ctx.split, ctx.dues) });
  const mode = typeof d['mode_id'] === 'string' ? (ctx.modes.find((m) => m.mode_id === d['mode_id']) ?? ctx.mode) : ctx.mode;
  const type = mode === null ? '' : t(mode.payment_class === 'cash' ? 'billing.dues.cash_k' : 'billing.dues.card_k');
  const amount = e.code === 'PAYMENT_CASH_STEP' ? money('step_minor') : e.code === 'BILL_TOTAL_CHANGED' ? money('total_minor') : e.code === 'BILL_DUE_CHANGED' ? money('due_minor') : money('balance_minor');
  return fill(t(billingErrorKey(e.code, d, { direction: ctx.direction })), {
    mode: mode?.name ?? '',
    amount,
    type,
    n: Number.isSafeInteger(d['split_no']) ? String(d['split_no']) : String(ctx.split.split_no),
    threshold: money('threshold_minor'),
  });
}

/** The last close's answer, as frame BillClosed shows it (E-7). */
interface Done {
  /** an empty close (BillClosedEmpty): no invoice */
  empty: boolean;
  invoiceRef: string | null;
  totalMinor: number | null;
  changeMinor: number | null;
  /** the invoice the last close issued (Reprint receipt), null for an empty close */
  invoiceId: string | null;
  fiscalPending: boolean;
  /** the receipt job this close queued (CloseSplit `receipt`): shown until the reloaded bill lists it */
  receipt: { job_id: string | null; printer_name: string | null } | null;
}

/** #/bill?<ref>: one bill (`take-payment`). `onBack` returns to the open bills. */
export function BillScreen({ billRef, onBack }: { billRef: BillRef; onBack: () => void }) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const modes = useSyncExternalStore(shell.config.subscribe, () => activeModes(shell.config.snapshot()));

  const [bill, setBill] = useState<BillView | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [held, setHeld] = useState<HeldResult | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  // R-4 (E-6 leftover): the pad's Add payment, scrolled clear of the sticky Close bar when a mode opens the pad
  const addRef = useRef<HTMLButtonElement>(null);
  const modeId = mode?.mode_id ?? null;
  useLayoutEffect(() => {
    const add = addRef.current;
    const pane = add?.closest<HTMLElement>('.b5-pane');
    const bar = pane?.querySelector<HTMLElement>(':scope > .b5-close');
    if (modeId === null || add == null || pane == null || bar == null) return;
    const over = add.getBoundingClientRect().bottom - bar.getBoundingClientRect().top + PAD_CLEAR_PX;
    if (over > 0) pane.scrollTop += over;
  }, [modeId]);
  const [amount, setAmount] = useState('');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [change, setChange] = useState<number | null>(null);
  const [padMsg, setPadMsg] = useState<string | null>(null);
  const [closeMsg, setCloseMsg] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [noPrinter, setNoPrinter] = useState(false);
  // B19: the buyer of the next close, in memory only (a ref, never state or storage); dropped after the close answers
  const heldBuyer = useRef<BuyerEntry | null>(null);
  const [buyerHeld, setBuyerHeld] = useState(false);
  // E-1: the split editor and the discount / service-charge sheets
  const [sheet, setSheet] = useState<'split' | 'discount' | 'discount_remove' | 'service' | 'reopen' | null>(null);
  // 36c: the reopen this visit made (its credits, the mode the hub decided): the banner
  const [reopenedBy, setReopenedBy] = useState<{ mode: 'full' | 'corrections'; credits: Array<{ invoice_ref: string; total_minor: number }> } | null>(null);
  // E-3: the payment being removed
  const [removing, setRemoving] = useState<BillViewSplit['payments'][number] | null>(null);
  const [buyerSheet, setBuyerSheet] = useState<{ error: BuyerIssue | null; accepted: string[] | null } | null>(null);
  // WaiveBuyerId answered not_required: the row says so until the bill needs the buyer again
  const [buyerNotNeeded, setBuyerNotNeeded] = useState(false);
  const dropBuyer = () => {
    heldBuyer.current = null;
    setBuyerHeld(false);
  };

  const request = useRef(0);
  const refKey = JSON.stringify(billRef);
  /** the bill read; 'refused' (the screen shows it failed) or null (a later read overtook this one) */
  const load = useCallback(async (): Promise<BillView | 'refused' | null> => {
    const mine = ++request.current;
    const answer = await api.bill(JSON.parse(refKey) as BillRef);
    if (mine !== request.current) return null;
    if (!answer.ok) {
      setFailed(true);
      return 'refused';
    }
    setFailed(false);
    setBill(answer.data);
    setLoadedAt(shellRef.current.clock.nowMs());
    return answer.data;
  }, [api, refKey]);
  useEffect(() => {
    void load();
  }, [load]);
  // R-2 (§8 Print status): no frame carries a print job's ack, so after a print action (a reprint, Print to, a close
  // with a receipt, the check bill) the bill is read again every PRINT_WATCH_MS while THAT job is waiting or printing
  // (or not in the view yet): PRINT_WATCH_TRIES reads at most (a row still waiting then stays so until the next read);
  // the job printed / failed / cancelled, a refused read or going offline stops it. An older stuck job does not.
  const printWatch = useRef<{ left: number; timer: ReturnType<typeof setTimeout> | null }>({ left: 0, timer: null });
  const watchPrints = useCallback((jobId: string | null) => {
    if (jobId === null) {
      // nothing was printed (no printer): one read
      void load();
      return;
    }
    const w = printWatch.current;
    if (w.timer !== null) clearTimeout(w.timer);
    w.timer = null;
    w.left = PRINT_WATCH_TRIES;
    const read = async () => {
      w.timer = null;
      const b = await load();
      w.left -= 1;
      if (b === 'refused' || !shellRef.current.online) return;
      const job = b?.prints.find((p) => p.job_id === jobId);
      const pending = b === null || job === undefined || job.state === 'waiting' || job.state === 'printing';
      if (pending && w.left > 0 && w.timer === null) w.timer = setTimeout(() => void read(), PRINT_WATCH_MS);
    };
    void read();
  }, [load]);
  useEffect(() => {
    const w = printWatch.current;
    return () => {
      w.left = 0;
      if (w.timer !== null) clearTimeout(w.timer);
      w.timer = null;
    };
  }, []);
  useLiveRefetch(shell.live, () => void load(), BILL_LIST_FRAMES);
  // B19: a held buyer is for a bill that needs one; a refresh that lifts the need (or records the waiver) drops it,
  // so it is never sent for a bill that did not ask. "Not needed" lasts until the bill needs the buyer again.
  const needsBuyer = bill !== null && bill.buyer.required && !bill.buyer.waived;
  useEffect(() => {
    if (!needsBuyer) dropBuyer();
    else setBuyerNotNeeded(false);
  }, [needsBuyer]);

  if (bill === null)
    return (
      <main className="b5 b5--page">
        {failed ? (
          <div className="msg c-danger" role="alert">
            <Ico name="warn" />
            <span>{t('billing.bill.load_failed')}</span>
            <button type="button" className="btn" onClick={() => void load()}>
              {t('orders.retry')}
            </button>
          </div>
        ) : (
          <p className="muted">{t('common.loading')}</p>
        )}
      </main>
    );

  const code = bill.currency.code;
  const money = (m: number) => billMoney(m, code);
  const online = shell.online;
  const split = bill.splits.find((s) => s.split_no === picked) ?? bill.splits.find((s) => s.state === 'open') ?? bill.splits[0];
  const open = split !== undefined && split.state === 'open' && bill.state !== 'closed';
  const discountGrant = shell.permissions.allowed('apply-discount') || shell.permissions.requiresApproval('apply-discount');
  // 36c, §8 Reopen (R-89): reopen-bill holders, allowed or requires_approval (R5)
  const canReopenGrant = shell.permissions.allowed('reopen-bill') || shell.permissions.requiresApproval('reopen-bill');
  const dues = split === undefined ? null : duesOf(split, held);
  // §3.3 rule 6: a close carrying a valid buyer passes the buyer rule, so a held buyer lifts that block
  const blocks = split === undefined ? [] : bill.blocks.filter((b) => (b.split_no === null || b.split_no === split.split_no) && !(buyerHeld && b.reason === 'buyer_id_required'));
  const paid = split === undefined ? 0 : split.payments.reduce((n, p) => n + (p.direction === 'in' ? p.amount_minor : -p.amount_minor), 0);
  const refund = split !== undefined && split.balance_minor < 0;
  const direction: 'in' | 'out' = refund ? 'out' : 'in';
  const exponent = bill.currency.exponent;

  const pick = (m: Mode) => {
    setMode(m);
    setPadMsg(null);
    setChange(null);
    setTendered('');
    setReference('');
    const due = dues === null ? null : refund ? (m.payment_class === 'cash' ? dues.cash_refund_due_minor : dues.card_refund_due_minor) : m.payment_class === 'cash' ? dues.cash_due_minor : dues.card_due_minor;
    setAmount(due !== null && due > 0 ? amountText(due, code) : '');
  };

  const amountMinor = parseMinor(amount, exponent);
  const tenderedMinor = tendered.trim() === '' ? null : parseMinor(tendered, exponent);
  const cashIn = mode !== null && mode.payment_class === 'cash' && direction === 'in';
  // the missing step: no valid amount (the button stays the action word, disabled), else the words of the step
  const padStep: MessageKey | 'amount' | null =
    mode === null
      ? null
      : amountMinor === null
        ? 'amount'
        : cashIn && tendered.trim() !== '' && tenderedMinor === null
          ? 'pad.enter_tendered'
          : cashIn && tenderedMinor !== null && tenderedMinor < amountMinor
            ? 'pad.tendered_short'
            : mode.reference_required && reference.trim() === ''
              ? 'errors.PAYMENT_REFERENCE_REQUIRED'
              : null;

  const addPayment = async () => {
    if (split === undefined || mode === null || padStep !== null || busy || !online) return;
    setBusy(true);
    setPadMsg(null);
    const answer = await api.addPayment({
      bill_ref: billRef,
      split_no: split.split_no,
      mode_id: mode.mode_id,
      direction,
      amount_minor: amountMinor as number,
      // ⚠️ 05 v1.0.37 §6.9 (R2-1): the due the pad shows for this mode (a stale screen is refused BILL_DUE_CHANGED)
      expected_due_minor: dues === null ? Math.abs(split.balance_minor) : refund ? (mode.payment_class === 'cash' ? dues.cash_refund_due_minor : dues.card_refund_due_minor) : mode.payment_class === 'cash' ? dues.cash_due_minor : dues.card_due_minor,
      ...(cashIn && tenderedMinor !== null ? { tendered_minor: tenderedMinor } : {}),
      ...(mode.reference_required || reference.trim() !== '' ? { reference: reference.trim() } : {}),
    });
    setBusy(false);
    if (!answer.ok) {
      const e = answer.error;
      // 00 command pipeline: this command_id was used by a first send the hub did apply (its reply was lost) and the
      // resend differs (an edited Cash given): the payment may be in already — never let a second press take it again
      const reused = e.kind === 'api' && e.code === 'VALIDATION_FAILED' && Array.isArray(e.details['issues']) && (e.details['issues'] as Array<{ path?: unknown }>).some((i) => i.path === 'command_id');
      if (reused) {
        setPadMsg(t('pad.maybe_in'));
        setAmount('');
        setTendered('');
        setReference('');
        setMode(null);
        await load();
        return;
      }
      setPadMsg(refusalText(answer.error, { bill, split, dues, mode, modes, direction }));
      // ⚠️ 05 v1.0.37 §8 (R2-1): the bill changed since the pad read it — the amounts typed for the old due go
      if (e.kind === 'api' && e.code === 'BILL_DUE_CHANGED') {
        setAmount('');
        setTendered('');
      }
      // a refusal means the screen was stale (a total, a due, the split's state): read the bill again
      if (answer.error.kind === 'api') await load();
      return;
    }
    const r: AddPaymentResult = answer.data;
    // B30: the reference is not kept on the screen once sent
    setReference('');
    setTendered('');
    setHeld({
      split_no: r.split_no,
      payment_id: r.payment_id,
      balance_minor: r.balance_minor,
      total_minor: r.totals?.as_paid?.total_minor ?? -1,
      card_due_minor: r.card_due_minor,
      cash_due_minor: r.cash_due_minor,
      card_refund_due_minor: r.card_refund_due_minor,
      cash_refund_due_minor: r.cash_refund_due_minor,
    });
    setChange(cashIn ? r.change_due_minor : null);
    setAmount('');
    await load();
  };

  const closeSplit = async () => {
    if (split === undefined || blocks.length > 0 || busy || !online || !open) return;
    setBusy(true);
    setCloseMsg(null);
    setBanner(null);
    const buyer = heldBuyer.current;
    const answer = await api.closeSplit({ bill_ref: billRef, split_no: split.split_no, expected_total_minor: split.totals.as_paid.total_minor, ...(buyer === null ? {} : { buyer }) });
    setBusy(false);
    // B19: the buyer is sent once; any answer drops it (a lost reply keeps it for the same close's resend)
    if (answer.ok || answer.error.kind !== 'network') dropBuyer();
    if (!answer.ok) {
      const e = answer.error;
      if (e.kind === 'api' && (e.code === 'BUYER_ID_REQUIRED' || buyerIssue(e) !== null)) {
        const listed = e.details['accepted_types'];
        const accepted = e.code === 'BUYER_ID_REQUIRED' && Array.isArray(listed) && listed.every((x) => typeof x === 'string') ? (listed as string[]) : null;
        setBuyerSheet({ error: e.code === 'BUYER_ID_REQUIRED' ? null : buyerIssue(e), accepted });
        await load();
        return;
      }
      if (e.kind === 'api' && e.code === 'BILL_TOTAL_CHANGED') {
        // rule 7: read again and show the new total; never close by itself
        setBanner(fill(t('billing.total_changed'), { amount: typeof e.details['total_minor'] === 'number' ? money(e.details['total_minor']) : '' }));
        await load();
        return;
      }
      setCloseMsg(refusalText(e, { bill, split, dues, mode, modes, direction }));
      if (e.kind === 'api') await load();
      return;
    }
    const r = answer.data;
    const text = 'empty' in r ? t('billing.closed_empty') : fill(t('billing.closed'), { invoice_ref: r.invoice_ref, amount: money(r.total_minor) });
    const doneOf: Done =
      'empty' in r
        ? { empty: true, invoiceRef: null, totalMinor: null, changeMinor: null, invoiceId: null, fiscalPending: false, receipt: null }
        : { empty: false, invoiceRef: r.invoice_ref, totalMinor: r.total_minor, changeMinor: r.change_minor > 0 ? r.change_minor : null, invoiceId: r.invoice_id, fiscalPending: r.fiscal_state === 'pending', receipt: r.receipt };
    const changeText = 'empty' in r || r.change_minor <= 0 ? null : fill(t('billing.give_change'), { amount: money(r.change_minor) });
    if (r.bill_state === 'closed') setReopenedBy(null);
    if (r.bill_state === 'closed') setDone(doneOf);
    else shell.toasts.show({ text: changeText === null ? text : `${text} · ${changeText}`, tone: 'ok' });
    setMode(null);
    setPicked(null);
    // R-2: a close that printed a receipt watches it to its ack
    if (!('empty' in r) && r.receipt.job_id !== null) watchPrints(r.receipt.job_id);
    else await load();
  };

  const states: Array<{ key: MessageKey; tone: string }> = [
    { key: bill.state === 'partly_paid' ? 'billing.state.partly_paid' : bill.state === 'closed' ? 'billing.state.closed' : 'billing.state.open', tone: bill.state === 'partly_paid' ? 'c-info' : bill.state === 'closed' ? 'c-ok' : 'c-mute' },
    ...(bill.reopen_count >= 1 && bill.state !== 'closed' ? [{ key: 'billing.state.reopened' as MessageKey, tone: 'c-warn' }] : []),
  ];

  const header = (
    <div className="b5-bh">
      <button type="button" className="btn btn--icon" aria-label={t('billing.nav')} onClick={onBack}>
        <Ico name="back" />
      </button>
      <span className="tcode">{bill.identifier}</span>
      <div className="b5-bh__t">
        <h1>{bill.identifier}</h1>
        <div className="b5-bh__m">
          {states.map((s) => (
            <span key={s.key} className={`st ${s.tone} st--lg`}>
              {t(s.key)}
            </span>
          ))}
          <span className="i">{t(`billing.type.${bill.order_type}` as MessageKey)}</span>
          {bill.check_printed_at !== null && <span className="i">{fill(t('billing.badge.check_printed'), { time: timeText(bill.check_printed_at, shell.clock.utcOffsetMs) })}</span>}
        </div>
      </div>
    </div>
  );

  // 05 v1.0.33 §8 (STAB-5): a split line's parts as one row
  const rows = groupBillLines(bill.lines);
  const lines = (
    <section className="b5-lines">
      <div className="b5-lines__h">
        <div className="b5-h">
          {t('billing.lines.title')}
          <span className="end">{fill(t('billing.lines.count'), { n: String(rows.length) })}</span>
        </div>
      </div>
      <div className="b5-scroll">
        {rows.map(({ line: l }) => (
          <div key={l.order_item_id} className={l.tags.includes('pending_void') ? 'ol pend' : 'ol'}>
            <span className="ol__q num">{`${l.units}×`}</span>
            <span className="ol__n">
              <b>{l.name}</b>
              {(l.tags.length > 0 || (l.added_after_close && bill.splits.some((x) => x.state === 'closed'))) && (
                <span className="b5-tags">
                  {l.added_after_close && bill.splits.some((x) => x.state === 'closed') && <span className="b5-tg c-new">{t('billing.tag.new')}</span>}
                  {l.tags.map((g) => (
                    <span key={g} className={TAG_CLASS[g] ?? 'b5-tg'}>
                      {t(TAG[g] ?? 'billing.tag.comp')}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="ol__e">
              <span className="ol__p num" dir={MONEY_DIR}>
                {amountText(l.base_minor, code)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );

  const strip =
    bill.splits.length > 1 ? (
      <div className="b5-splits" role="group">
        {bill.splits.map((s) => (
          <button
            key={s.split_no}
            type="button"
            className={['b5-sp', s.state === 'closed' ? 'done' : null, s.split_no === split?.split_no ? 'is-sel' : null].filter((c) => c !== null).join(' ')}
            aria-pressed={s.split_no === split?.split_no}
            onClick={() => setPicked(s.split_no)}
          >
            <b>{fill(t(s.state === 'closed' ? 'billing.bill.split_closed' : 'billing.bill.split_open'), { n: String(s.split_no) })}</b>
            {s.state === 'closed' && <span>{fill(t('billing.bill.paid_split'), { invoice_ref: s.invoice?.invoice_ref ?? '' })}</span>}
          </button>
        ))}
      </div>
    ) : null;

  // §3.2.11 the buyer row (frame BillBuyerRequired): needed + Add buyer; added (no name, no value, no last 4); waived
  const buyerRow =
    bill.buyer.required && open ? (
      bill.buyer.waived ? (
        <div className="b5-ban b5-buyer c-info">
          <Ico name="info" />
          <div>
            <b>{t('billing.buyer.waived')}</b>
            <span>{t('billing.buyer.waived_sub')}</span>
          </div>
        </div>
      ) : buyerHeld ? (
        <div className="b5-ban b5-buyer c-ok">
          <Ico name="checkc" />
          <div>
            <b>{t('billing.buyer.added')}</b>
          </div>
          {/* the value is never shown again, so a mistake is fixed by typing it afresh */}
          <button
            type="button"
            className="btn"
            onClick={() => {
              dropBuyer();
              setBuyerSheet({ error: null, accepted: null });
            }}
          >
            {t('billing.buyer.change')}
          </button>
        </div>
      ) : (
        <div className="b5-ban b5-buyer c-warn">
          <Ico name="user" />
          <div>
            <b>{fill(t('billing.buyer.needed'), { threshold: bill.buyer.threshold_minor === null ? '' : money(bill.buyer.threshold_minor) })}</b>
            <span>{t('billing.buyer.needed_sub')}</span>
          </div>
          {online && (
            <button type="button" className="btn btn--tone c-warn" onClick={() => setBuyerSheet({ error: null, accepted: null })}>
              {t('billing.buyer.add')}
            </button>
          )}
        </div>
      )
    ) : buyerNotNeeded && open ? (
      <div className="b5-ban b5-buyer c-info">
        <Ico name="info" />
        <div>
          <b>{t('billing.buyer.not_needed')}</b>
          <span>{t('billing.buyer.not_needed_sub')}</span>
        </div>
      </div>
    ) : null;
  const sym = currencySymbol(code);
  const dueCard = (cls: string, k: string, v: number, sub: string) => (
    <div className={`b5-due ${cls}`.trim()}>
      <span className="b5-due__k">{k}</span>
      <span className="b5-due__v" dir={MONEY_DIR}>
        <small>{sym}</small>
        {amountText(v, code)}
      </span>
      <span className="b5-due__s">{sub}</span>
    </div>
  );
  const duesBlock =
    split === undefined ? null : (
      <>
        {dues !== null && split.balance_minor > 0 && (
          <div className="b5-dues">
            {dueCard('cash', t('billing.dues.cash_k'), dues.cash_due_minor, t('pad.total_cash'))}
            {dueCard('', t('billing.dues.card_k'), dues.card_due_minor, t('pad.total_card'))}
          </div>
        )}
        {split.balance_minor === 0 && split.payments.length > 0 && open && <div className="b5-dues one">{dueCard('zero', t('billing.dues.balance_k'), 0, t('billing.dues.nothing_left'))}</div>}
        {dues !== null && refund && (
          // §8, H17-1: per type up to what it paid; a type with 0 is hidden
          <div className="b5-dues one">
            {dues.cash_refund_due_minor > 0 && dueCard('refund', t('billing.refund.cash_k'), dues.cash_refund_due_minor, fill(t('billing.refund.cash'), { amount: money(dues.cash_refund_due_minor) }))}
            {dues.card_refund_due_minor > 0 && dueCard('refund', t('billing.refund.card_k'), dues.card_refund_due_minor, fill(t('billing.refund.card'), { amount: money(dues.card_refund_due_minor) }))}
          </div>
        )}
        {split.payments.length > 0 && <div className="b5-paid num">{fill(t('billing.dues.paid_left'), { paid: money(paid), left: money(split.balance_minor) })}</div>}
        {split.payments.length > 0 && (
          <div className="b5-pays">
            {split.payments.map((p) => (
              <div key={p.payment_id} className="b5-pay">
                <span>{p.mode_name}</span>
                <span className="num" dir={MONEY_DIR}>
                  {money(p.direction === 'in' ? p.amount_minor : -p.amount_minor)}
                </span>
                {p.tendered_minor !== null && <small>{fill(t('pad.payment.tendered_change'), { tendered: money(p.tendered_minor), change: money(p.change_minor) })}</small>}
                {p.taken_by_name !== null && <small>{fill(t('pad.payment.by'), { name: p.taken_by_name })}</small>}
                {/* E-3, §6.10: before close (open split), online; another's payment needs close-shift-for-others too.
                    "Own" is the taker's staff id (R-90, §6.1 payments[].taken_by_staff_id) */}
                {online && open && shell.permissions.allowed('take-payment') && (p.taken_by_staff_id === shell.me?.staff_id || shell.permissions.allowed('close-shift-for-others')) && (
                  <button type="button" className="btn" onClick={() => setRemoving(p)}>
                    {t('billing.pay_remove.button')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </>
    );

  const sayDue = (m: Mode): number | null => {
    if (dues === null) return null;
    if (refund) return m.payment_class === 'cash' ? dues.cash_refund_due_minor : dues.card_refund_due_minor;
    return m.payment_class === 'cash' ? dues.cash_due_minor : dues.card_due_minor;
  };
  const sayLabel = (m: Mode) => (m.payment_class === 'cash' ? t('pad.total_cash') : m.kind === 'card' ? t('pad.total_card') : fill(t('pad.total_mode'), { mode: m.name }));

  const offlinePad =
    open && !online ? (
      <section className="b5-pad">
        <div className="b5-modes">
          {modes.map((m) => (
            <button key={m.mode_id} type="button" className="b5-mode off" aria-disabled="true">
              <span>{m.name}</span>
              <small>{t(m.payment_class === 'cash' ? 'pad.mode.cash' : m.reference_required ? 'pad.mode.digital_ref' : 'pad.mode.digital')}</small>
            </button>
          ))}
        </div>
        <div className="b5-pad__idle">
          <b>{t('tables.toast.needs_hub')}</b>
          {t('pad.offline_sub')}
        </div>
      </section>
    ) : null;

  const pad =
    open && online && split !== undefined ? (
      <section className="b5-pad">
        <div className="b5-modes">
          {modes.map((m) => (
            <button key={m.mode_id} type="button" className="b5-mode" aria-pressed={mode?.mode_id === m.mode_id} onClick={() => pick(m)}>
              <span>{m.name}</span>
              <small>{t(m.payment_class === 'cash' ? 'pad.mode.cash' : m.reference_required ? 'pad.mode.digital_ref' : 'pad.mode.digital')}</small>
            </button>
          ))}
        </div>
        {mode === null ? (
          <div className="b5-pad__idle">
            <b>{split.balance_minor === 0 ? t('pad.all_paid') : t('pad.idle')}</b>
            {split.balance_minor === 0 ? t('pad.all_paid_sub') : t('pad.idle_sub')}
            {padMsg !== null && (
              <div className="msg c-warn" role="alert">
                <Ico name="warn" />
                <span>{padMsg}</span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="b5-pad__say">
              <span>{sayLabel(mode)}</span>
              <b dir={MONEY_DIR}>{sayDue(mode) === null ? '—' : money(sayDue(mode) as number)}</b>
            </div>
            <div className="b5-fields">
              <label className="b5-fld">
                <span>{t('pad.amount')}</span>
                <div className="b5-in">
                  <small>{sym}</small>
                  <input inputMode="decimal" dir={MONEY_DIR} value={amount} onChange={(e) => setAmount(e.currentTarget.value)} />
                </div>
              </label>
              {cashIn && (
                <label className="b5-fld">
                  <span>{t('pad.tendered')}</span>
                  <div className="b5-in">
                    <small>{sym}</small>
                    <input inputMode="decimal" dir={MONEY_DIR} value={tendered} onChange={(e) => setTendered(e.currentTarget.value)} />
                  </div>
                </label>
              )}
              {mode.reference_required && (
                <label className="b5-fld">
                  <span>{t('pad.reference')}</span>
                  <div className="b5-in text">
                    <input autoComplete="off" maxLength={REFERENCE_MAX} value={reference} onChange={(e) => setReference(typedReference(e.currentTarget.value))} />
                  </div>
                  {/* QA BUG-27: the limit is visible */}
                  <span className="cntr num">{fill(t('note.count'), { n: String(referenceLength(reference)), max: String(REFERENCE_MAX) })}</span>
                </label>
              )}
              {cashIn && (
                <div className={change === null ? 'b5-change pre' : 'b5-change'}>
                  <span>
                    {t('pad.change_due_k')}
                    {change === null && <small>{t('pad.change_after_add')}</small>}
                  </span>
                  <b dir={MONEY_DIR}>{change === null ? '—' : money(change)}</b>
                </div>
              )}
            </div>
            {padMsg !== null && (
              <div className="msg c-warn" role="alert">
                <Ico name="warn" />
                <span>{padMsg}</span>
              </div>
            )}
            <button ref={addRef} type="button" className="btn btn--primary b5-add btn--block" aria-disabled={padStep !== null || busy} onClick={() => void addPayment()}>
              {padStep !== null && padStep !== 'amount' ? t(padStep) : t(refund ? 'pad.give_back' : 'pad.add')}
            </button>
          </>
        )}
      </section>
    ) : null;

  const why =
    blocks.length === 0 ? null : blocks.length === 1 ? (
      <div className="b5-why1">
        <Ico name="info" />
        <span>{split === undefined ? '' : blockText(blocks[0]!, bill, split, dues)}</span>
      </div>
    ) : (
      <ul className="b5-why">
        <li className="b5-why__h">{t('billing.blocks.head')}</li>
        {blocks.map((b, i) => (
          <li key={`${b.reason}-${i}`}>{split === undefined ? '' : blockText(b, bill, split, dues)}</li>
        ))}
      </ul>
    );

  const closeArea =
    split !== undefined && open ? (
      <div className="b5-close">
        <button
          type="button"
          className={online ? 'btn btn--primary btn--block' : 'btn btn--primary btn--block b5-needshub'}
          aria-disabled={blocks.length > 0 || busy || !online}
          onClick={() => void closeSplit()}
        >
          {bill.splits.length > 1 ? fill(t('billing.close_split'), { n: String(split.split_no) }) : t('billing.close')}
          {!online ? (
            <small>{` · ${t('tables.toast.needs_hub')}`}</small>
          ) : blocks.length === 0 ? (
            <small>{` · ${fill(t('billing.close_issues'), { amount: money(split.totals.as_paid.total_minor) })}`}</small>
          ) : null}
        </button>
        {why}
        {closeMsg !== null && (
          <div className="msg c-warn" role="alert">
            <Ico name="warn" />
            <span>{closeMsg}</span>
          </div>
        )}
      </div>
    ) : null;

  if (done !== null)
    return (
      <main className="b5 b5--page">
        {/* E-7, frame BillClosed: the hero, the change due, the receipt's print row, the acts, Done at the foot */}
        <div className="b5-done b5-done--page">
          <div className="b5-done__hero" role="status" aria-label={done.empty ? t('billing.closed_empty') : fill(t('billing.closed'), { invoice_ref: done.invoiceRef ?? '', amount: money(done.totalMinor ?? 0) })}>
            <span className="k">
              <Ico name="check" />
              {t('billing.closed_k')}
            </span>
            {done.empty ? (
              <span>{t('billing.closed_empty_line')}</span>
            ) : (
              <div className="inv">
                <span>
                  {t('billing.closed_invoice')} <span className="b5-mono">{done.invoiceRef}</span>
                </span>
                <b className="num" dir={MONEY_DIR}>
                  {money(done.totalMinor ?? 0)}
                </b>
              </div>
            )}
            {done.fiscalPending && (
              <div className="row b5-done__st">
                <span className="st c-info">{t('billing.closed_fiscal_pending')}</span>
              </div>
            )}
          </div>
          {done.changeMinor !== null && (
            <div className="b5-change">
              <span>{t('pad.change_due_k')}</span>
              <b dir={MONEY_DIR}>{money(done.changeMinor)}</b>
            </div>
          )}
          {/* this close's receipt job only: the reloaded bill's row, else the close answer's (waiting) until it lands */}
          {done.receipt !== null && done.receipt.job_id !== null && (
            <PrintRows
              prints={
                bill.prints.some((p) => p.job_id === done.receipt!.job_id)
                  ? bill.prints.filter((p) => p.job_id === done.receipt!.job_id)
                  : [{ job_id: done.receipt.job_id, doc_kind: 'receipt', state: 'waiting', printer_name: done.receipt.printer_name, last_error: null }]
              }
            />
          )}
          <span className="b5-dc__fill" />
          {done.invoiceId !== null && (shell.permissions.allowed('take-payment') || (canReopenGrant && online && bill.state === 'closed')) && (
            <div className="b5-acts">
              {/* §6.22, frame BillClosed: Reprint receipt of the invoice this close issued */}
              {done.invoiceId !== null && shell.permissions.allowed('take-payment') && <ReprintButton doc="receipt" invoiceId={done.invoiceId} onPrinted={() => {}} />}
              {/* 36c, frame BillClosed: Reopen from the closed view */}
              {canReopenGrant && online && done.invoiceId !== null && bill.state === 'closed' && (
                <MaskedAction permissions={shell.permissions} permission="reopen-bill">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setDone(null);
                      setSheet('reopen');
                    }}
                  >
                    {t('billing.reopen.button')}
                    {shell.permissions.requiresApproval('reopen-bill') && <span className="ntag">{t('billing.sheet.needs')}</span>}
                  </button>
                </MaskedAction>
              )}
            </div>
          )}
          <div className="b5-close">
            <button type="button" className="btn btn--primary btn--block" onClick={onBack}>
              <Ico name="check" />
              {t('billing.done_next')}
            </button>
          </div>
        </div>
      </main>
    );

  return (
    <div className="b5 b5--page">
      {!online && (
        <div className="b5-off" role="status">
          <Ico name="wifioff" />
          {fill(t('billing.bill.offline'), { time: loadedAt === null ? '' : timeText(loadedAt, shell.clock.utcOffsetMs) })}
        </div>
      )}
      {banner !== null && (
        <div className="b5-ban c-warn" role="alert">
          {banner}
        </div>
      )}
      {/* 36c, frame ReopenCorrections: the result's credits; the mode sets the line */}
      {reopenedBy !== null && (
        <div className="b5-ban c-ok" role="status">
          <Ico name="checkc" />
          <div>
            <b>{fill(t('billing.reopen.done'), { credits: reopenedBy.credits.map((c) => `${c.invoice_ref} ${money(c.total_minor)}`).join(', ') })}</b>
            {reopenedBy.mode === 'corrections' && <span>{t('billing.reopen.corrections')}</span>}
          </div>
        </div>
      )}
      <main className="b5-t">
        <section className="b5-col">
          <div className="b5-pane">
            {header}
            {online && bill.state !== 'closed' && (
              <div className="b5-acts">
                <CheckBillButton billRef={billRef} onPrinted={(r) => (r.printed ? watchPrints(r.job_id) : setNoPrinter(true))} />
                {/* §6.5 SetSplits: take-payment, as the hub */}
                {shell.permissions.allowed('take-payment') && (
                  <button type="button" className="btn" onClick={() => setSheet('split')}>
                    <BIco name="split" />
                    {t('billing.split.button')}
                  </button>
                )}
                {discountGrant && canDiscount(bill) && (
                  <MaskedAction permissions={shell.permissions} permission="apply-discount">
                    <button type="button" className="btn" onClick={() => setSheet('discount')}>
                      <BIco name="bill" />
                      {t('billing.discount.button')}
                      {shell.permissions.requiresApproval('apply-discount') && <span className="ntag">{t('billing.sheet.needs')}</span>}
                    </button>
                  </MaskedAction>
                )}
              </div>
            )}
            {lines}
            {/* E-3, B18: onChanged lets a failed / late job open the Print to picker */}
            <PrintRows prints={bill.prints} noPrinter={noPrinter ? 'check' : null} {...(shell.permissions.allowed('take-order') ? { onChanged: watchPrints } : {})} />
          </div>
        </section>
        <section className="b5-col b5-money">
          <div className="b5-pane">
            {strip}
            {split !== undefined && (
              <TotalsTable
                split={split}
                bill={bill}
                paid={paid}
                modes={modes}
                billRef={billRef}
                onRemoveDiscount={online && open && bill.discount !== null && discountGrant && canDiscount(bill) ? () => setSheet('discount_remove') : null}
                onRemoveCharge={() => setSheet('service')}
                onChanged={() => void load()}
                online={online}
              />
            )}
            {buyerRow}
            {duesBlock}
            {pad}
            {offlinePad}
            {closeArea}
            {!open && split !== undefined && split.invoice !== null && <div className="b5-note">{fill(t('billing.bill.paid_split'), { invoice_ref: split.invoice.invoice_ref })}</div>}
            {/* 36c: Reopen on a CLOSED bill, or on a closed split's invoice of a PARTLY_PAID bill (it reopens the whole bill) */}
            {canReopenGrant && online && split !== undefined && split.state === 'closed' && split.invoice !== null && (bill.state === 'closed' || bill.state === 'partly_paid') && (
              <MaskedAction permissions={shell.permissions} permission="reopen-bill">
                <button type="button" className="btn" onClick={() => setSheet('reopen')}>
                  {t('billing.reopen.button')}
                  {shell.permissions.requiresApproval('reopen-bill') && <span className="ntag">{t('billing.sheet.needs')}</span>}
                </button>
              </MaskedAction>
            )}
            {/* §6.22, R-90: the split's current sale invoice, from the view (a later visit too; a re-close shows the new one) */}
            {!open && split !== undefined && split.invoice !== null && online && shell.permissions.allowed('take-payment') && (
              <ReprintButton doc="receipt" invoiceId={split.invoice.invoice_id} onPrinted={watchPrints} />
            )}
          </div>
        </section>
      </main>
      {removing !== null && (
        <RemovePaymentSheet
          bill={bill}
          payment={removing}
          onDone={() => {
            setRemoving(null);
            void load();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
      {sheet === 'reopen' && (
        <ReopenSheet
          bill={bill}
          onRefresh={() => void load()}
          onDone={(r) => {
            if (r.kind === 'reopened') setReopenedBy({ mode: r.mode, credits: r.credits });
            if (r.kind === 'pending') setReopenedBy(null);
            if (r.kind !== 'pending') setSheet(null);
            void load();
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'split' && (
        <SplitEditor
          bill={bill}
          billRef={billRef}
          onSaved={() => {
            setSheet(null);
            void load();
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {(sheet === 'discount' || sheet === 'discount_remove') && (
        <DiscountSheet
          bill={bill}
          billRef={billRef}
          mode={sheet === 'discount' ? 'apply' : 'remove'}
          onDone={(r) => {
            if (r !== 'pending') setSheet(null);
            void load();
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'service' && (
        <ServiceChargeSheet
          bill={bill}
          billRef={billRef}
          onDone={(r) => {
            if (r !== 'pending') setSheet(null);
            void load();
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {buyerSheet !== null && (
        <BuyerSheet
          bill={bill}
          error={buyerSheet.error}
          accepted={buyerSheet.accepted}
          onUse={(entry) => {
            heldBuyer.current = entry;
            setBuyerHeld(true);
            setBuyerSheet(null);
          }}
          onWaived={(r) => {
            if (r !== 'pending') setBuyerSheet(null);
            if (r === 'not_required') setBuyerNotNeeded(true);
            void load();
          }}
          onClose={() => setBuyerSheet(null)}
        />
      )}
    </div>
  );
}

/** A close refusal on the buyer's fields (VALIDATION_FAILED at payload.buyer.tax_id.value / .type), never echoing it. */
function buyerIssue(e: HubError): BuyerIssue | null {
  if (e.kind !== 'api' || e.code !== 'VALIDATION_FAILED' || !Array.isArray(e.details['issues'])) return null;
  const paths = (e.details['issues'] as Array<{ path?: unknown }>).map((i) => String(i.path ?? ''));
  if (paths.some((x) => x.includes('buyer.tax_id.type'))) return 'type';
  if (paths.some((x) => x.includes('buyer.name'))) return 'name';
  if (paths.some((x) => x.includes('buyer'))) return 'value';
  return null;
}
