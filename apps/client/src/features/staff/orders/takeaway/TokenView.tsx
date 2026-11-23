import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../../../../app/router';
import { t, type MessageKey } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import { billingApi } from '../../../billing/api';
import type { BillView } from '../../../billing/contracts';
import { useShell, type Shell } from '../../shell/hooks';
import { ContactSheet } from '../actions/ContactSheet';
import type { OrderViewBody, SeatingLine } from '../contracts';
import { useLiveRefetch } from '../lists/OpenOrders';
import { MONEY_DIR, money } from '../money';
import { groupParts, type GroupedLine } from '../view/parts';
import { atStageOne, isServed, isWeightPending, servable } from '../view/stage';
import { voidOffered, type LineOrder } from '../view/LineActions';
import { RemoveSheet } from '../actions/RemoveSheet';
import { VoidSheet } from '../../../voids/VoidSheet';
import { VoidButton } from '../../../voids/ui';
import { MaskedAction } from '../../shell/MaskedAction';
import type { TokenBook } from './book';
import { maskPhone } from './mask';
import type { QueueToken } from './queue-model';
import './styles';

// 02b-TK C2-2 (02b v1.0.24 §3.7, §6.4, §6.18, §6.18a; 05 v1.0.34 §6.1, B16; frames TokenDue, TokenReady,
// TokenPartial, PhoneToken; ruling R2): the token view, a drawer over the menu and the cart (the cart is kept; a full
// screen on the phone). The token big, who placed it; Ready by / Bill / Phone facts; each item with its stage
// (Waiting / Cooking / Ready / Handed over) from `order-view` (§6.18a) of every order of the token; the bill from
// `bill?order_id=` of the token's NEWEST order (05 #44e: after the root bill closed an addition opens a new bill on the
// same key; then the root's bill shows too). Actions: Give ready items now (MarkServed of the ready lines), Hand over
// all, Take payment (the bill screen), Add items, Remove / cancel, Call, Bill.
// R2 (no hub guard, 05 B16 as approved): on a Due bill Hand over all is greyed; a MANAGER may hand over unpaid. The
// client's rule for "manager": the session holds `apply-discount` outright (grant `allowed`) — the Manager / Owner
// default roles; the Cashier default holds it only with approval. Hand-overs go through the 5 s Undo (handover.ts).

export interface TokenViewProps {
  token: QueueToken;
  book: TokenBook;
  onClose(): void;
  /** hand these lines over (after the Undo window) */
  onHandOver(lines: GroupedLine[]): void;
  /** C2-3: add items to this token */
  onAddItems?: (() => void) | undefined;
}

/** R2: who may hand over a Due order (documented rule: `apply-discount` granted outright). */
export function isManager(shell: Pick<Shell, 'permissions'>): boolean {
  return shell.permissions.allowed('apply-discount');
}

/** A line the counter can hand over now: the kitchen has it done, or it never went to a station. */
export const readyNow = (l: SeatingLine): boolean => l.stage === 'done' || l.stage === null || l.stage === 'out_of_engine' || l.zone_served;

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
  current: { paid: boolean; amount_minor: number; bill_id: string | null } | null;
  /** the root's bill when it is another, closed one (05 #44e) */
  earlier: { amount_minor: number } | null;
}

/** Paid = the bill closed (its total); Due = what the open splits still owe, or the whole total of a projected bill. */
export function billFact(b: BillView): { paid: boolean; amount_minor: number; bill_id: string | null } {
  if (b.state === 'closed') return { paid: true, amount_minor: b.totals_default.total_minor, bill_id: b.bill_id };
  const open = b.splits.filter((s) => s.state === 'open');
  const owed = open.reduce((n, s) => n + Math.max(0, s.balance_minor), 0);
  return { paid: false, amount_minor: open.length === 0 ? b.totals_default.total_minor : owed, bill_id: b.bill_id };
}

export function TokenView({ token, book, onClose, onHandOver, onAddItems }: TokenViewProps) {
  const shell = useShell();
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const offset = shell.clock.utcOffsetMs;
  const [orders, setOrders] = useState<OrderViewBody[] | null>(null);
  const [gone, setGone] = useState(false);
  const [bill, setBill] = useState<BillFacts | null>(null);
  const [call, setCall] = useState(false);
  // 02b-TK C2-4: Remove / cancel shows each line's way off the order; the sheet open for one line
  const [removing, setRemoving] = useState(false);
  const [sheet, setSheet] = useState<{ kind: 'remove' | 'void'; line: SeatingLine; order: LineOrder } | null>(null);
  const ids = token.order_ids.join(' ');
  const request = useRef(0);
  const load = useCallback(async () => {
    const mine = ++request.current;
    const orderIds = ids.split(' ');
    const api = billingApi(shellRef.current.api);
    const newest = orderIds.at(-1)!;
    const root = orderIds[0]!;
    const [views, current, earlier] = await Promise.all([
      Promise.all(orderIds.map((id) => shellRef.current.orders.orderView(id))),
      api.bill({ order_id: newest }),
      root === newest ? Promise.resolve(null) : api.bill({ order_id: root }),
    ]);
    if (mine !== request.current) return;
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
  const allReady = candidates.length > 0 && readyLines.length === candidates.length;
  const paid = bill?.current?.paid ?? token.paid;
  const due = bill?.current !== null && bill?.current !== undefined && !bill.current.paid;
  const manager = isManager(shell);
  const may = shell.permissions.allowed;
  const canServe = may('mark-served');
  const first = orders?.[0] ?? null;
  const promises = (orders ?? []).flatMap((o) => (o.promise_ms === null ? [] : [o.promise_ms]));
  const promise = promises.length === 0 ? token.promise_ms : Math.max(...promises);
  const phoned = orders?.find((o) => o.has_phone) ?? null;
  const masked = maskPhone(token.phone ?? book.get(token.order_ids[0]!)?.phone);
  const ident = token.token === null ? '—' : String(token.token);
  const what = `${t('order.takeaway')} · ${ident}`;
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
      className={`tk-btn tk-btn--xl ${allReady && (paid || manager) ? 'tk-btn--ok' : ''}`}
      aria-disabled={!allReady || (!paid && !manager)}
      onClick={() => {
        if (!allReady || (!paid && !manager)) return;
        onHandOver(candidates);
      }}
    >
      {t(!paid && manager ? 'v.override' : 'v.collected')}
      {!allReady && promise !== null && (
        <>
          {' · '}
          <span className="time" dir="ltr">
            {timeText(promise, offset)}
          </span>
        </>
      )}
    </button>
  );

  return (
    <>
      <button type="button" className="tk-scrim--fixed" aria-label={t('common.close')} onClick={onClose} />
      <section className="tk-drawer" role="dialog" aria-modal="true" aria-label={what} data-token={token.key}>
        <div className="tk-drawer__h">
          <span className="tk-tv__tok" dir="ltr">
            {ident}
          </span>
          <div className="tk-tv__who">
            <b dir="auto">{token.customer_name ?? t('order.takeaway')}</b>
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
          <div className="tk-facts">
            <div className="tk-fact">
              <small>{t('v.ready_at')}</small>
              <b dir="ltr">{promise === null ? '—' : timeText(promise, offset)}</b>
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
          {due && !manager && candidates.length > 0 && (
            <p className="tk-hint" role="note">
              {t('v.pay_first')}
            </p>
          )}
        </div>
        <div className="tk-drawer__f">
          {canServe && readyLines.length > 0 && !allReady && (
            <button type="button" className="tk-btn tk-btn--lg" onClick={() => onHandOver(readyLines)}>
              {t('v.give_ready')}
              {giveText}
            </button>
          )}
          {due && may('take-payment') && (
            <button type="button" className="tk-btn tk-btn--xl tk-btn--primary" onClick={toBill}>
              {t('v.pay')} · <span dir={MONEY_DIR}>{money(bill!.current!.amount_minor)}</span>
            </button>
          )}
          {canServe && candidates.length > 0 && handOverAll}
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
