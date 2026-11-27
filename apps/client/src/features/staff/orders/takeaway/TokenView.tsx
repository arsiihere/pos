import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { navigate } from '../../../../app/router';
import { t, type MessageKey } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import { billingApi } from '../../../billing/api';
import type { BillView } from '../../../billing/contracts';
import { useShell } from '../../shell/hooks';
import { ContactSheet } from '../actions/ContactSheet';
import type { OpenOrder, OrderViewBody, SeatingLine } from '../contracts';
import { useLiveRefetch } from '../lists/OpenOrders';
import { MONEY_DIR, money } from '../money';
import { groupParts, type GroupedLine } from '../view/parts';
import { atStageOne, isServed, isWeightPending, servable } from '../view/stage';
import { showOrderError, voidOffered, type LineOrder } from '../view/LineActions';
import { RemoveSheet } from '../actions/RemoveSheet';
import { CheckBill, ReceiptAgain, receiptOf } from './CheckBill';
import { PrintSlip } from './PrintSlip';
import { VoidSheet } from '../../../voids/VoidSheet';
import { VoidButton } from '../../../voids/ui';
import { MaskedAction } from '../../shell/MaskedAction';
import type { TokenBook } from './book';
import { maskPhone } from './mask';
import { notCollectedMinOf, plannedReadyOf, type QueueToken } from './queue-model';
import { CarriedDate, ReadyTime, useHubNow } from './QueueRail';
import { AskManager } from '../unpaid/AskManager';
import { blockedOrders, candidatesOf, checkHandover, dueGate, gateOf, lineIds, type BillRow, type Gate } from '../unpaid/candidate';
import { unpaidRequestsOf } from '../unpaid/requests';
import './styles';

// 02b-TK C2-2 (02b v1.0.24 §3.7, §6.4, §6.18, §6.18a; 05 v1.0.34 §6.1, B16; frames TokenDue, TokenReady,
// TokenPartial, PhoneToken; ruling R2): the token view, a drawer over the menu and the cart (the cart is kept; a full
// screen on the phone). The token big, who placed it; Ready by / Bill / Phone facts; each item with its stage
// (Waiting / Cooking / Ready / Handed over) from `order-view` (§6.18a) of every order of the token; the bill from
// `bill?order_id=` of the token's NEWEST order (05 #44e: after the root bill closed an addition opens a new bill on the
// same key; then the root's bill shows too). Actions: Give ready items now (MarkServed of the ready lines), Hand over
// all, Take payment (the pay panel over the cart, C3-1; hidden offline), Add items, Remove / cancel, Call, Bill.
// R2 (no hub guard, 05 B16 as approved): on a Due bill Hand over all is greyed with "Take payment first" until it is
// paid — for everyone: the pilot has NO client manager override (owner ruling 2026-11-24 #2). Hand-overs go through
// the 5 s Undo (handover.ts).
// ⚠️ 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a, §8 OR-7; D2, D3): the shared candidate check (unpaid/candidate.ts)
// per order of the token — billed / paid / due 0 → free; Due → free only with an effective approval of THAT order at
// its fresh due (requests.ts). Hand over all and Give ready items now never take the last live line of a Due,
// unapproved order (lines waiting in an Undo window count as taken); the blocked newest such order gets "Ask a
// manager" (RequestUnpaidHandover) under "Take payment first". Unknown billing blocks.

export interface TokenViewProps {
  token: QueueToken;
  book: TokenBook;
  onClose(): void;
  /** hand these lines over (after the Undo window) */
  onHandOver(lines: GroupedLine[]): void;
  /** C2-3: add items to this token */
  onAddItems?: (() => void) | undefined;
  /** C3-1: Take payment opens the pay panel (else the bill screen) */
  onPay?: (() => void) | undefined;
  /** line ids already waiting in an Undo window (§8 OR-7) */
  reserved?: ReadonlySet<string> | undefined;
}

/** A line the counter can hand over now: the kitchen has it done, or it never went to a station. */
export const readyNow = (l: SeatingLine): boolean => l.stage === 'done' || l.stage === null || l.stage === 'out_of_engine' || l.zone_served;

/**
 * Owner ruling 2026-11-24 #1 (02b v1.0.24 §3.7, §6.4): the token's live lines — every line of the root and its
 * additions still to give: not a deal header, not removed / voided, not served; a no-station option child goes with
 * its parent. A line not yet sent to the kitchen is live (and not ready).
 */
export function liveLines<L extends SeatingLine>(lines: readonly L[]): L[] {
  return lines.filter((l) => l.line_kind !== 'deal' && l.live_units > 0 && !isServed(l) && l.stage !== 'removed' && l.stage !== 'voided' && !(l.line_kind === 'option_child' && l.stage === null));
}

/** Hand over all only when EVERY live line can be handed over now — not only the lines sent to the kitchen. */
export function allLiveReady(lines: readonly SeatingLine[]): boolean {
  const live = liveLines(lines);
  return live.length > 0 && live.every((l) => servable(l) && readyNow(l));
}

function chipOf(l: SeatingLine): { key: MessageKey; tone: string } {
  if (isWeightPending(l)) return { key: 'stage.weight_pending', tone: 'tk-chip--warn' };
  if (l.stage === 'returned' || l.returned_units > 0) return { key: 'stage.sent_back', tone: 'tk-chip--danger' };
  if (isServed(l)) return { key: 'v.given', tone: '' };
  if (readyNow(l)) return { key: 'v.ready', tone: 'tk-chip--ok' };
  if (l.stage === 'cooking') return { key: 'v.cooking', tone: 'tk-chip--warn' };
  return { key: 'v.waiting', tone: '' };
}

export interface BillFacts {
  /** the newest order's bill */
  current: { paid: boolean; amount_minor: number; bill_id: string | null; invoice_id?: string | null } | null;
  /** the root's bill when it is another, closed one (05 #44e) */
  earlier: { amount_minor: number } | null;
}

/** Paid = the bill closed (its total); Due = what the open splits still owe, or the whole total of a projected bill. */
export function billFact(b: BillView): { paid: boolean; amount_minor: number; bill_id: string | null; invoice_id?: string | null } {
  // ⚠️ 05 §8 (OR-5): a paid bill keeps the receipt to print again (its newest closed split's invoice)
  // a closed bill's totals_default is its OPEN remainder (05 §6.1: zero once every split is closed): what it was paid is
  // what its closed splits invoiced — Σ their totals (a closed split's totals are its current invoice's)
  if (b.state === 'closed') {
    const paid = b.splits.filter((s) => s.state === 'closed').reduce((n, s) => n + s.totals.as_paid.total_minor, 0);
    return { paid: true, amount_minor: paid, bill_id: b.bill_id, invoice_id: receiptOf(b) };
  }
  const open = b.splits.filter((s) => s.state === 'open');
  const owed = open.reduce((n, s) => n + Math.max(0, s.balance_minor), 0);
  return { paid: false, amount_minor: open.length === 0 ? b.totals_default.total_minor : owed, bill_id: b.bill_id };
}

export function TokenView({ token, book, onClose, onHandOver, onAddItems, onPay, reserved }: TokenViewProps) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const offset = shell.clock.utcOffsetMs;
  const [orders, setOrders] = useState<OrderViewBody[] | null>(null);
  const [gone, setGone] = useState(false);
  const [bill, setBill] = useState<BillFacts | null>(null);
  const [call, setCall] = useState(false);
  // ⚠️ 02b-TK L-CLIENT-5 item 2 (02b v1.0.25 §6.6, §8 02b-R4-3; 03a v1.2.11 PK-5; D1): Customer is here (BoostOrder) —
  // in flight, and the orders this drawer boosted (the token passed in is the rail's last read)
  const [boosting, setBoosting] = useState(false);
  const [boosted, setBoosted] = useState<ReadonlySet<string>>(new Set());
  // 02b-TK C2-4: Remove / cancel shows each line's way off the order; the sheet open for one line
  const [removing, setRemoving] = useState(false);
  const [sheet, setSheet] = useState<{ kind: 'remove' | 'void'; line: SeatingLine; order: LineOrder } | null>(null);
  // ⚠️ 02b v1.0.25 §6.16 (owner ruling BR-1): the token's open-orders rows of this view's last read (null: not read or
  // not every order listed → the rail's token value), for "Ready ~{planned}" after Customer is here
  const [planRows, setPlanRows] = useState<OpenOrder[] | null>(null);
  // BUG-9 (owner ruling 2026-11-28, approval ruling A; §6.16 `bill`, `unpaid_handover_approved`; D2): each order's own
  // open-orders row of this view's last read, for its own due and the hub's approval flag (a frame this page missed)
  const [billRows, setBillRows] = useState<ReadonlyMap<string, BillRow>>(new Map());
  const ids = token.order_ids.join(' ');
  const request = useRef(0);
  const load = useCallback(async () => {
    const mine = ++request.current;
    const orderIds = ids.split(' ');
    const api = billingApi(shellRef.current.api);
    const newest = orderIds.at(-1)!;
    const root = orderIds[0]!;
    const [views, current, earlier, open] = await Promise.all([
      Promise.all(orderIds.map((id) => shellRef.current.orders.orderView(id))),
      api.bill({ order_id: newest }),
      root === newest ? Promise.resolve(null) : api.bill({ order_id: root }),
      (async () => {
        try {
          return await shellRef.current.orders.openOrders({ order_type: 'takeaway' });
        } catch {
          return null;
        }
      })(),
    ]);
    if (mine !== request.current) return;
    const listed = open?.ok === true ? open.data.orders.filter((r) => orderIds.includes(r.order_id)) : [];
    setPlanRows(listed.length === orderIds.length ? listed : null);
    setBillRows(new Map(listed.map((r) => [r.order_id, r])));
    if (listed.length > 0) unpaidRequestsOf(shellRef.current).seed(listed);
    const found = views.flatMap((v) => (v.ok && v.data.kind === 'order' ? [v.data.order] : []));
    setGone(found.length === 0 && views.every((v) => !v.ok && v.error.kind === 'api' && v.error.code === 'ORDER_NOT_FOUND'));
    setOrders(found);
    const cur = current.ok ? billFact(current.data) : null;
    const old = earlier?.ok === true ? billFact(earlier.data) : null;
    setBill({ current: cur, earlier: old !== null && old.paid && old.bill_id !== cur?.bill_id ? { amount_minor: old.amount_minor } : null });
  }, [ids]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefetch(shell.live, () => void load());

  const lines = useMemo(() => (orders ?? []).flatMap((o) => groupParts(o.lines)), [orders]);
  const shown = lines.filter((l) => l.line_kind !== 'deal' && l.line_kind !== 'option_child' && l.live_units > 0);
  const candidates = lines.filter(servable);
  const readyLines = candidates.filter(readyNow);
  const live = liveLines(lines);
  const allReady = allLiveReady(lines);
  // ⚠️ 02b-TK L-CLIENT-2 item 2 (03b v1.0.16 §3.4 R3-M-9, D8; frame TokenLate): past the R8 window and every live line
  // still ready (this drawer's own read: a line back to the kitchen ends it, D8) → "Ready {n} min ago — not collected"
  const nowMs = useHubNow(token.late_from != null);
  const lateMin = allReady ? notCollectedMinOf(token, nowMs) : null;
  // some ready, not all: Give ready items now in place of Hand over all (owner ruling 2026-11-24 #1)
  const giveReady = readyLines.length > 0 && !allReady;
  const paid = bill?.current?.paid ?? token.paid;
  const due = bill?.current !== null && bill?.current !== undefined && !bill.current.paid;
  // ⚠️ OR-7 (D2): each order's gate from this view's reads (order-view `billed`, the newest order's bill)
  const unpaid = unpaidRequestsOf(shell);
  useSyncExternalStore(unpaid.subscribe, unpaid.version);
  const gate = (order_id: string): Gate => {
    if (orders?.find((o) => o.order_id === order_id)?.billed === true) return { kind: 'free' };
    // BUG-9: the order's own row (its due, the hub's flag); this page's approval of that due counts too (a frame
    // ahead of the next read)
    const row = billRows.get(order_id);
    if (row?.bill !== undefined) {
      const approvedDue = unpaid.approvedDue(order_id);
      const g = gateOf(row, { approvedDue });
      return g.kind === 'due' && !g.approved && approvedDue !== undefined && g.due_minor <= approvedDue ? { ...g, approved: true } : g;
    }
    const cur = bill?.current;
    if (cur == null) return token.paid ? { kind: 'free' } : { kind: 'unknown' };
    return cur.paid ? { kind: 'free' } : dueGate(cur.amount_minor, undefined, unpaid.approvedDue(order_id));
  };
  const cands = candidatesOf(token.order_ids, liveLines(lines), gate);
  const fullCheck = checkHandover(cands, lineIds(candidates), reserved);
  const giveCheck = checkHandover(cands, lineIds(readyLines), reserved);
  // BUG-9 (owner ruling 2026-11-28, approval ruling A): one Ask a manager per blocked order, each with its own due
  const blocked = !fullCheck.ok && fullCheck.reason === 'due' ? blockedOrders(cands, lineIds(candidates), reserved) : !giveCheck.ok && giveCheck.reason === 'due' ? blockedOrders(cands, lineIds(readyLines), reserved) : [];
  // ⚠️ 02b v1.0.26 (owner 2026-11-28 Q9): one request per BILL — orders sharing a bill (`bill.key`) ask once, by the
  // bill's oldest order; an addition-only bill is marked "(addition)"
  const seenBills = new Set<string>();
  const asks = blocked.filter((a) => {
    const key = billRows.get(a.order_id)?.bill?.key ?? a.order_id;
    if (seenBills.has(key)) return false;
    seenBills.add(key);
    return true;
  });
  const billKeyOf = (order_id: string) => billRows.get(order_id)?.bill?.key ?? order_id;
  const may = shell.permissions.allowed;
  const canServe = may('mark-served');
  const first = orders?.[0] ?? null;
  const promises = (orders ?? []).flatMap((o) => (o.promise_ms === null ? [] : [o.promise_ms]));
  const promise = promises.length === 0 ? token.promise_ms : Math.max(...promises);
  const planned = planRows === null ? (token.planned_ready_at_ms ?? null) : plannedReadyOf(planRows);
  const phoned = orders?.find((o) => o.has_phone) ?? null;
  const fullScreen = shell.phone || shell.portrait;
  const showContact = !fullScreen && shell.device.type === 'cashier_kiosk' || may('view-customer-contact');
  const masked = showContact ? maskPhone(token.phone ?? book.get(token.order_ids[0]!)?.phone) : null;
  const ident = token.token === null ? '—' : String(token.token);
  const what = `${t('order.takeaway')} · ${ident}`;
  // the token's orders still waiting for their pickup; BoostOrder is not queueable (§6.6): online, boost-order only
  const waiting = (token.pickup_order_ids ?? (token.effective_pickup_at_ms != null ? [token.newest_order_id] : [])).filter((id) => !boosted.has(id));
  const offerHere = waiting.length > 0 && may('boost-order') && shell.online;
  const customerHere = async () => {
    if (boosting) return;
    setBoosting(true);
    const done = new Set(boosted);
    try {
      for (const order_id of waiting) {
        const answer = await shellRef.current.orders.boostOrder({ order_id });
        if (!answer.ok) {
          showOrderError(shellRef.current, answer.error, () => void load());
          return;
        }
        done.add(order_id);
      }
      shellRef.current.toasts.show({ text: t('v.here_done'), tone: 'ok' });
    } finally {
      setBoosted(done);
      setBoosting(false);
      void load();
    }
  };
  const toBill = () => navigate(`/bill?order_id=${encodeURIComponent(token.newest_order_id)}`);
  // 02b §6.2 / 04 §6.1: one order's lines for the Remove and Void sheets (an addition is its own order)
  const lineOrder = (order_id: string): LineOrder | null => {
    const o = orders?.find((x) => x.order_id === order_id);
    return o === undefined ? null : { order_id, order_type: 'takeaway', ident, billed: o.billed, lines: groupParts(o.lines) };
  };
  const voidGrant = shell.permissions.resolution('void-item').grant;
  const canRemove = may('take-order') || voidGrant === 'allowed' || voidGrant === 'requires_approval';
  // 05 §3.10 / §6.9: a paid (closed) bill takes nothing off here — the bill is reopened (ReopenBill, approvable), then
  // the item removed or voided, and the bill shows the refund to give (AddPayment out) before it closes again
  const refundFirst = removing && (paid || (orders ?? []).some((o) => o.billed));
  const done = () => {
    setSheet(null);
    void load();
  };
  const qty = (l: SeatingLine) => (l.sale_unit === 'piece' ? `${l.live_units}×` : '');
  const giveText = readyLines.length === 1 ? ` · ${qty(readyLines[0]!)} ${readyLines[0]!.name}` : ` · ${readyLines.length}`;

  const handOverAll = (
    <button
      type="button"
      className={`tk-btn tk-btn--xl ${allReady && fullCheck.ok ? 'tk-btn--ok' : ''}`}
      aria-disabled={!allReady || !fullCheck.ok}
      onClick={() => {
        if (!allReady || !fullCheck.ok) return;
        onHandOver(candidates);
      }}
    >
      {t('v.collected')}
      {!allReady && promise !== null && (
        <>
          {' · '}
          <ReadyTime promise={promise} planned={planned} utcOffsetMs={offset} />
        </>
      )}
    </button>
  );

  return (
    <>
      {!fullScreen && <button type="button" className="tk-scrim--fixed" aria-label={t('common.close')} onClick={onClose} />}
      <section className={fullScreen ? "tk-drawer tk-drawer--phone" : "tk-drawer"} role="dialog" aria-modal="true" aria-label={what} data-token={token.key}>
        <div className="tk-drawer__h">
          <span className="tk-tv__tok" dir="ltr">
            {ident}
          </span>
          <div className="tk-tv__who">
            {/* ⚠️ 02b-TK L-CLIENT-5 item 3 (02b v1.0.25 §3.3; DC-2): a carried token's date beside its number */}
            <CarriedDate q={token} />
            <b dir="auto">{(showContact ? token.customer_name : null) ?? t('order.takeaway')}</b>
            {first !== null && (
              <small>
                {fill(t('v.placed'), { t: timeText(first.placed_at, offset), who: first.placed_by.name ?? '—' })}
              </small>
            )}
          </div>
          <button type="button" className="tk-x" aria-label={t('common.close')} onClick={onClose}>
            <Ico name="x" />
          </button>
        </div>
        <div className="tk-drawer__b">
          {lateMin !== null && (
            <div className="tk-banner tk-banner--warn" role="status" data-late="">
              <span>{fill(t('v.late'), { n: String(lateMin) })}</span>
              {phoned !== null && may('view-customer-contact') && (
                <button type="button" className="tk-btn tk-btn--primary" onClick={() => setCall(true)}>
                  {t('v.call')}
                </button>
              )}
            </div>
          )}
          <div className="tk-facts">
            <div className="tk-fact">
              <small>{t('v.ready_at')}</small>
              <b dir="ltr">{promise === null ? '—' : <ReadyTime promise={promise} planned={planned} utcOffsetMs={offset} stack />}</b>
            </div>
            {bill?.earlier != null && (
              <div className="tk-fact tk-fact--paid">
                <small>{t('v.bill')} 1</small>
                <b>
                  {t('q.paid')} · <span dir={MONEY_DIR}>{money(bill.earlier.amount_minor)}</span>
                </b>
              </div>
            )}
            <div className={`tk-fact ${bill?.current == null ? '' : bill.current.paid ? 'tk-fact--paid' : 'tk-fact--due'}`}>
              <small>{bill?.earlier != null ? `${t('v.bill')} 2` : t('v.bill')}</small>
              <b>
                {bill?.current == null ? (
                  '—'
                ) : (
                  <>
                    {t(bill.current.paid ? 'q.paid' : 'q.due')} · <span dir={MONEY_DIR}>{money(bill.current.amount_minor)}</span>
                  </>
                )}
              </b>
            </div>
            {/* ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §6.16, §8; D1): the pickup as placed, kept after a boost */}
            {token.pickup_at_ms != null && (
              <div className="tk-fact" data-pickup="">
                <small>{t('c.pickup')}</small>
                <b dir="ltr">{timeText(token.pickup_at_ms, offset)}</b>
              </div>
            )}
            <div className="tk-fact">
              <small>{t('c.phone')}</small>
              <b dir="ltr">{masked ?? '—'}</b>
            </div>
          </div>
          {gone && (
            <div className="tk-msg" role="status">
              <Ico name="info" />
              <span>{t('line.err.gone')}</span>
            </div>
          )}
          <div className="col">
            {shown.map((l) => {
              const chip = chipOf(l);
              return (
                <div key={l.order_item_id} className={isServed(l) ? 'tk-il tk-il--done' : 'tk-il'} data-line={l.order_item_id}>
                  <span className="tk-il__q num">{qty(l)}</span>
                  <div className="tk-il__n">
                    <b dir="auto">{l.name}</b>
                    {l.kitchen_note !== null && <small dir="auto">{l.kitchen_note}</small>}
                  </div>
                  <span className={`tk-chip ${chip.tone}`}>{t(chip.key)}</span>
                  {removing && <RemoveActions line={l} order={lineOrder(l.order_id)} onPick={(kind, order) => setSheet({ kind, line: l, order })} />}
                </div>
              );
            })}
          </div>
          {refundFirst && (
            <div className="tk-msg" role="status">
              <Ico name="info" />
              <span>{t('v.refund_first')}</span>
              <button type="button" className="tk-btn" onClick={toBill}>
                {t('v.bill')}
              </button>
            </div>
          )}
          {due && live.length > 0 && (
            <p className="tk-hint" role="note">
              {t('v.pay_first')}
            </p>
          )}
          {canServe &&
            asks.map((a) => (
              <AskManager
                key={a.order_id}
                order_id={a.order_id}
                due_minor={a.due_minor}
                ident={token.order_ids.length > 1 ? `#${ident}` : undefined}
                addition={billKeyOf(a.order_id) !== billKeyOf(token.order_ids[0]!)}
                variant="drawer"
                onChanged={() => void load()}
              />
            ))}
        </div>
        <div className="tk-drawer__f">
          {canServe && giveReady && (
            <button
              type="button"
              className="tk-btn tk-btn--lg"
              aria-disabled={!giveCheck.ok}
              onClick={() => {
                // §3.7a (R2-M-7, TK-Q19): never the last live line of a Due, unapproved order
                if (giveCheck.ok) onHandOver(readyLines);
              }}
            >
              {t('v.give_ready')}
              {giveText}
            </button>
          )}
          {/* 02b-TK C3-1 (05 B12): money needs the hub — offline Take payment is hidden and the token stays Due */}
          {due && may('take-payment') && shell.online && (
            <button type="button" className="tk-btn tk-btn--xl tk-btn--primary" onClick={onPay ?? toBill}>
              {t('v.pay')} · <span dir={MONEY_DIR}>{money(bill!.current!.amount_minor)}</span>
            </button>
          )}
          {offerHere && (
            <button type="button" className="tk-btn tk-btn--lg" disabled={boosting} onClick={() => void customerHere()} data-here="">
              {t('v.here')}
            </button>
          )}
          {canServe && live.length > 0 && !giveReady && handOverAll}
          <div className="tk-grid3">
            {onAddItems !== undefined && may('take-order') && (
              <button type="button" className="tk-btn" onClick={onAddItems}>
                {t('v.add')}
              </button>
            )}
            {canRemove && (
              <button type="button" className="tk-btn" aria-pressed={removing} onClick={() => setRemoving((r) => !r)}>
                {t('v.remove')}
              </button>
            )}
            {/* 02b-TK C3-2 (05 §6.3; R6): the check bill of the token's newest order while it is Due */}
            {due && may('take-order') && <CheckBill order_id={token.newest_order_id} />}
            {/* ⚠️ 02b-TK L-CLIENT-3 item 2 (03c v1.0.16 §3.11, §6.14, §8): Print token (the slip, reprint) on a Due token */}
            {due && may('take-order') && <PrintSlip order_id={token.newest_order_id} order_ids={token.order_ids} onRefused={() => void load()} />}
            {/* ⚠️ 02b-TK L-CLIENT-3 item 1 (05 v1.0.35 §8 OR-5, §6.22; #60h): once paid, Print receipt again (take-payment only) */}
            {bill?.current?.paid === true && may('take-payment') && <ReceiptAgain order_id={token.newest_order_id} invoice_id={bill.current.invoice_id ?? null} />}
            {phoned !== null && may('view-customer-contact') && (
              <button type="button" className="tk-btn" onClick={() => setCall(true)}>
                {t('v.call')}
              </button>
            )}
            <button type="button" className="tk-btn" onClick={toBill}>
              {t('v.bill')}
            </button>
          </div>
        </div>
      </section>
      {call && phoned !== null && <ContactSheet order_id={phoned.order_id} what={what} onClose={() => setCall(false)} />}
      {sheet?.kind === 'remove' && (
        <RemoveSheet
          order={sheet.order}
          from={sheet.line.order_item_id}
          onClose={() => setSheet(null)}
          onDone={done}
          onChanged={() => void load()}
          onVoid={voidGrant === 'allowed' || voidGrant === 'requires_approval' ? (line) => setSheet({ kind: 'void', line, order: sheet.order }) : undefined}
        />
      )}
      {sheet?.kind === 'void' && (
        <VoidSheet
          line={sheet.line}
          order={sheet.order}
          onClose={() => setSheet(null)}
          onDone={done}
          onChanged={() => void load()}
          onRemove={may('take-order') ? () => setSheet({ ...sheet, kind: 'remove' }) : undefined}
        />
      )}
    </>
  );
}

/**
 * 02b §3.5 / §6.2 (RemoveItems before the kitchen starts, free) and 04 §6.1 (VoidItems after, `void-item`; with
 * `requires_approval` it raises a request and the line waits for the manager): the way off the order for one line.
 */
function RemoveActions({ line, order, onPick }: { line: SeatingLine; order: LineOrder | null; onPick(kind: 'remove' | 'void', order: LineOrder): void }) {
  const shell = useShell();
  if (order === null || line.live_units === 0 || isServed(line)) return null;
  if (atStageOne(line, order.lines))
    return shell.permissions.allowed('take-order') && !order.billed ? (
      <span className="tk-il__acts">
        <button type="button" className="tk-btn" onClick={() => onPick('remove', order)}>
          {t('line.remove')}
        </button>
      </span>
    ) : null;
  if (!voidOffered(shell, line, order)) return null;
  return (
    <span className="tk-il__acts">
      <MaskedAction permissions={shell.permissions} permission="void-item">
        <VoidButton approval={shell.permissions.resolution('void-item').grant === 'requires_approval'} onClick={() => onPick('void', order)} />
      </MaskedAction>
    </span>
  );
}
