import type { BranchConfig } from '@pos/events';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Dialog, Ico, Ring } from '../../../alerts/ui';
import type { CarType, SubmitResult } from '../contracts';
import type { Cart } from '../order-screen/cart';

// 02-D07 (handoff Sending, Sent, SentToken, SentParking, SentQueued, SentZoneEmpty; 02b §8 Ordering screen, Types,
// Queue, §10 #35 / #36): "Sending to the kitchen…" until the hub's 2xx — never "Sent" before it; then the final
// times with "Time updated: Karahi 8:29 PM", or the big token (takeaway) / the plate (parking); a zone line the
// zone could not serve "Zone empty — Raita sent to the kitchen" (once, with this result); offline "Not sent yet"
// (the token comes after sending). An already-accepted send (own pending id, no result) is shown as Sent.

export type SendView =
  | { kind: 'sending'; sub: string }
  | { kind: 'sent'; result: SubmitResult | undefined; cart: Cart; updated: { name: string; eta_ms: number } | null; zone_empty: string[] }
  | { kind: 'queued' };

export interface SendDialogProps {
  view: SendView;
  config: BranchConfig;
  order_type: 'dine_in' | 'takeaway' | 'parking';
  utcOffsetMs: number;
  /** the identity line ("F4 + F5 · Round 2") */
  title: string | null;
  sheet: boolean;
  onDone(): void;
  onNew(): void;
}

const CAR: Record<CarType, 'order.parking.small' | 'order.parking.sedan' | 'order.parking.large'> = { mini: 'order.parking.small', sedan: 'order.parking.sedan', large: 'order.parking.large' };

function nameOf(config: BranchConfig, cart: Cart, key: string): { q: string; name: string } {
  const line = cart.lines.find((l) => l.key === key);
  if (line === undefined) return { q: '', name: '' };
  const name = line.deal_id !== undefined ? (config.deals.find((d) => d.deal_id === line.deal_id)?.name ?? '') : (config.items.find((i) => i.item_id === line.item_id)?.name ?? '');
  return { q: line.quantity === null ? '' : `${line.quantity}×`, name };
}

export function SendDialog(p: SendDialogProps) {
  const noop = () => {};
  if (p.view.kind === 'sending')
    return (
      <Dialog sheet={p.sheet} labelledBy="send-t" onClose={noop}>
        <div className="done" aria-live="polite">
          <Ring size={110} pct={null} tone="brand">
            <Ico name="send" />
          </Ring>
          <strong id="send-t">{t('send.sending')}</strong>
          <span>{p.view.sub}</span>
        </div>
      </Dialog>
    );
  if (p.view.kind === 'queued')
    return (
      <Dialog sheet={p.sheet} labelledBy="send-t" onClose={p.onDone}>
        <div className="done">
          <Ring size={110} pct={null} tone="warn">
            <Ico name="wifioff" />
          </Ring>
          <strong id="send-t">{t('send.not_yet')}</strong>
          <span>{t('send.not_yet_sub')}</span>
        </div>
        <div className="acts acts--1">
          <button type="button" className="btn btn--primary" onClick={p.onDone}>
            {t('draft.ok')}
          </button>
        </div>
      </Dialog>
    );

  const { result, cart, updated, zone_empty } = p.view;
  const promise = result === undefined || result.groups.length === 0 ? null : Math.max(...result.groups.map((g) => g.promise_ms));
  const done = (
    <button type="button" className="btn btn--primary" onClick={p.onDone}>
      <Ico name="check" />
      {t('send.done')}
    </button>
  );
  if (p.order_type !== 'dine_in' && result !== undefined) {
    const by = promise === null ? '' : ` · ${fill(t('send.ready_by'), { time: timeText(promise, p.utcOffsetMs) })}`;
    return (
      <Dialog sheet={p.sheet} labelledBy="send-t" onClose={p.onDone}>
        <div className="token">
          {p.order_type === 'takeaway' ? (
            <>
              <small id="send-t">{t('send.token')}</small>
              <b className="num">{result.token}</b>
              <span dir="auto">
                {t('order.takeaway')}
                {cart.takeaway?.customer_name === undefined ? '' : ` · ${cart.takeaway.customer_name}`}
                {by}
              </span>
            </>
          ) : (
            <>
              <small id="send-t">{t('order.parking')}</small>
              <span className="plate" dir="ltr">
                {cart.parking?.car_number}
              </span>
              <span>
                {cart.parking === undefined ? '' : t(CAR[cart.parking.car_type])}
                {by}
              </span>
            </>
          )}
        </div>
        <div className="acts">
          <button type="button" className="btn" onClick={p.onNew}>
            {t(p.order_type === 'takeaway' ? 'send.new_takeaway' : 'send.new_parking')}
          </button>
          {done}
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog sheet={p.sheet} labelledBy="send-t" onClose={p.onDone}>
      <div className="dlg__h">
        {p.title !== null && <span className="tcode j">{p.title}</span>}
        <div className="dlg__t">
          <h2 id="send-t">{t('send.sent')}</h2>
          {promise !== null && (
            <div className="ac__who">
              {t('send.food_together_at')} <b className="num">{timeText(promise, p.utcOffsetMs)}</b>
            </div>
          )}
        </div>
      </div>
      {zone_empty.length > 0 && (
        <div className="msg c-warn" role="alert">
          <Ico name="warn" />
          <span>{fill(t('send.zone_empty'), { item: zone_empty.join(', ') })}</span>
        </div>
      )}
      {updated !== null && (
        <div className="msg c-info" role="alert">
          <Ico name="info" />
          <span>{fill(t('send.time_updated'), { item: updated.name, time: timeText(updated.eta_ms, p.utcOffsetMs) })}</span>
        </div>
      )}
      {result !== undefined && (
        <div className="slines">
          {result.lines
            .filter((l) => cart.lines.some((c) => c.key === l.order_item_id))
            .map((l) => {
              const n = nameOf(p.config, cart, l.order_item_id);
              const moved = updated !== null && n.name === updated.name;
              return (
                <div key={l.order_item_id} className={moved ? 'sl hl' : 'sl'}>
                  <span className="q num">{n.q}</span>
                  <b>{n.name}</b>
                  <span className={moved ? 'eta moved' : 'eta'} dir="ltr">
                    <Ico name="clock" />
                    <span className="num">{l.eta_ms === null || l.zone_served ? t('cart.now') : timeText(l.eta_ms, p.utcOffsetMs)}</span>
                  </span>
                </div>
              );
            })}
        </div>
      )}
      <div className="acts acts--1">{done}</div>
    </Dialog>
  );
}
