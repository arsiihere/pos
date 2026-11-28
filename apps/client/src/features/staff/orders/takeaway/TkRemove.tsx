import { useState } from 'react';
import { newUlid } from '../../../../app/ulid';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Dialog } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { definitiveRefusal } from '../../tables/errors';
import type { RemoveItemsPayload, SeatingLine } from '../contracts';
import { MONEY_DIR, money } from '../money';
import { partEntries } from '../view/parts';
import { atStageOne, lineStage, stageText } from '../view/stage';
import { showOrderError, voidOffered, type LineOrder } from '../view/LineActions';
import { TkIco } from './icons';

// ⚠️ 02b-TK L-CLIENT-6b item 5 (frame TokenRemove; MAPPING TK-D07; 02b §3.5, §6.2 RemoveItems; 04 §6.1 VoidItems): Remove /
// cancel on a token is one dialog over the drawer — every live line of the token's orders: a line not started has a
// per-unit stepper (free, RemoveItems), a line past stage 1 "Void · approval" (its 04 Void sheet). The bill line says
// what the removal does to the money ("Bill goes from Rs 1,800 to Rs 1,550. Not paid yet, so no refund."); a paid bill
// is reopened first (05 §3.10; v.refund_first). The frame's reason chips are NOT built: RemoveItems carries no reason
// (02b §6.2; reported as a spec gap). One submission per order = one command_id each, kept for a retry after a lost
// reply (D32 / M19), as RemoveSheet does.

export interface TkRemoveProps {
  ident: string;
  orders: LineOrder[];
  /** the token's bill: what is owed / was paid; null = not read */
  bill: { paid: boolean; amount_minor: number } | null;
  onClose(): void;
  onDone(): void;
  onChanged(): void;
  onVoid?: ((line: SeatingLine, order: LineOrder) => void) | undefined;
  onBill(): void;
}

/** What n units of a line take off the bill: its total per unit (a weighed line goes whole). */
export function unitValue(line: SeatingLine): number {
  const total = line.line_total_minor ?? 0;
  if (line.sale_unit !== 'piece' || line.live_units === 0) return total;
  return Math.round(total / Math.max(1, line.units));
}

export function TkRemove(p: TkRemoveProps) {
  const shell = useShell();
  const [units, setUnits] = useState<ReadonlyMap<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Map<string, { commandId: string; payload: RemoveItemsPayload }> | null>(null);
  const approval = shell.permissions.resolution('void-item').grant === 'requires_approval';
  const paid = p.bill?.paid === true || p.orders.some((o) => o.billed);
  // RemoveItems needs take-order (02b §6.2); without it a not-started line offers nothing
  const canTake = shell.permissions.allowed('take-order');
  const rows = p.orders.flatMap((order) => order.lines.filter((l) => l.parent_order_item_id === null && l.live_units > 0 && l.stage !== 'served').map((line) => ({ line, order })));
  const total = [...units.values()].reduce((a, b) => a + b, 0);
  const off = rows.reduce((sum, { line }) => sum + (units.get(line.order_item_id) ?? 0) * unitValue(line), 0);
  const set = (id: string, n: number) => {
    if (pending !== null) return;
    setUnits((cur) => {
      const next = new Map(cur);
      if (n <= 0) next.delete(id);
      else next.set(id, n);
      return next;
    });
  };
  const send = async () => {
    if (total === 0 || busy) return;
    const attempts =
      pending ??
      new Map(
        p.orders.flatMap((order) => {
          const lines = [...units].filter(([id]) => order.lines.some((l) => l.order_item_id === id)).flatMap(([id, n]) => partEntries(order.lines, id, n));
          return lines.length === 0 ? [] : [[order.order_id, { commandId: newUlid(), payload: { order_id: order.order_id, ...(order.seating_id === undefined ? {} : { seating_id: order.seating_id }), lines } }] as const];
        }),
      );
    setPending(attempts);
    setBusy(true);
    try {
      for (const [order_id, a] of attempts) {
        const answer = await shell.api.command<{ removed: Array<{ order_item_id: string; units: number }> }>('RemoveItems', a.payload, { commandId: a.commandId });
        if (answer.ok) {
          attempts.delete(order_id);
          continue;
        }
        if (definitiveRefusal(answer.error) === null && answer.error.kind !== 'signed_out') {
          shell.toasts.show({ text: t('line.err.lost'), tone: 'warn' });
          setPending(new Map(attempts));
          return;
        }
        setPending(null);
        setUnits(new Map());
        showOrderError(shell, answer.error, p.onChanged);
        return;
      }
      setPending(null);
      shell.toasts.show({ text: t('stage.badge.removed') });
      p.onDone();
    } finally {
      setBusy(false);
    }
  };
  const one = [...units.keys()];
  const oneName = one.length === 1 ? (rows.find((r) => r.line.order_item_id === one[0])?.line.name ?? null) : null;
  const go = total === 0 ? t('tr.pick') : oneName !== null ? fill(t('tr.go'), { n: String(total), item: oneName }) : fill(t('tr.go_n'), { n: String(total) });
  return (
    <Dialog sheet={shell.phone} labelledBy="tr-t" onClose={p.onClose} className="dlg--w tk-dlg tk-remove">
      <h2 id="tr-t" className="tk-dlg__t">
        {t('tr.title')}{' '}
        <span dir="ltr" className="num">
          {p.ident}
        </span>
      </h2>
      <div className="tk-remove__rows">
        {rows.map(({ line, order }) => {
          const n = units.get(line.order_item_id) ?? 0;
          const stage = lineStage(line);
          const stageWord = stage === null ? '' : stageText(stage, shell.clock.utcOffsetMs);
          const qty = line.sale_unit === 'piece' ? `${line.live_units}×` : '';
          if (!atStageOne(line, order.lines)) {
            const can = p.onVoid !== undefined && voidOffered(shell, line, order);
            return (
              <div key={line.order_item_id} className="tk-il" data-line={line.order_item_id}>
                <span className="tk-il__q num" dir="ltr">
                  {qty}
                </span>
                <div className="tk-il__n">
                  <b>
                    <bdi>{line.name}</bdi>
                  </b>
                  <small>
                    {stageWord} · {t(approval ? 'tr.void_mgr' : 'tr.void_ok')}
                  </small>
                </div>
                {can && (
                  <button type="button" className="tk-chip tk-chip--warn tk-remove__void" onClick={() => p.onVoid!(line, order)}>
                    <TkIco name="info" />
                    {t(approval ? 'tr.void_chip' : 'tr.void')}
                  </button>
                )}
              </div>
            );
          }
          return (
            <div key={line.order_item_id} className={n > 0 ? 'tk-il tk-remove__on' : 'tk-il'} data-line={line.order_item_id}>
              <span className="tk-il__q num" dir="ltr">
                {qty}
              </span>
              <div className="tk-il__n">
                <b>
                  <bdi>{line.name}</bdi>
                </b>
                <small>
                  {stageWord} · {t('tr.can_remove')}
                </small>
              </div>
              {canTake && <span className="tk-step tk-step--sm" role="group" aria-label={line.name}>
                <button type="button" aria-label={fill(t('opt.less'), { option: line.name })} disabled={n === 0 || paid} onClick={() => set(line.order_item_id, n - 1)}>
                  <TkIco name="minus" />
                </button>
                <output className="num">{n}</output>
                <button type="button" aria-label={fill(t('opt.more'), { option: line.name })} disabled={n >= line.live_units || paid} onClick={() => set(line.order_item_id, n + 1)}>
                  <TkIco name="plus" />
                </button>
              </span>}
            </div>
          );
        })}
      </div>
      {paid ? (
        <div className="tk-msg" role="status">
          <span>{t('v.refund_first')}</span>
          <button type="button" className="tk-btn" onClick={p.onBill}>
            {t('v.bill')}
          </button>
        </div>
      ) : (
        p.bill !== null &&
        total > 0 && (
          <p className="tk-remove__bill" role="status">
            {(() => {
              const [a, rest] = t('tr.bill').split('{from}');
              const [b, c] = (rest ?? '').split('{to}');
              return (
                <>
                  {a}
                  <span dir={MONEY_DIR}>{money(p.bill.amount_minor)}</span>
                  {b}
                  <span dir={MONEY_DIR}>{money(Math.max(0, p.bill.amount_minor - off))}</span>
                  {c}
                </>
              );
            })()}
          </p>
        )
      )}
      <div className="tk-dlg__acts">
        <button type="button" className="tk-btn tk-btn--lg" onClick={p.onClose}>
          {t('tr.keep')}
        </button>
        <button type="button" className="tk-btn tk-btn--lg tk-btn--danger" aria-disabled={total === 0 || busy || paid} onClick={() => void send()}>
          <TkIco name="trash" />
          {go}
        </button>
      </div>
    </Dialog>
  );
}
