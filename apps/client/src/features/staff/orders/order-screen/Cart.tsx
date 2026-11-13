import type { BranchConfig } from '@pos/events';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico, Ring } from '../../../alerts/ui';
import { timeText } from '../../../alerts/labels';
import { MONEY_DIR, money } from '../money';
import type { CartGroup, UnitOf } from './cart';
import { CartLineRow, type LineActions, type LineView } from './CartLine';

// 02-S05 cart (400 px; handoff Order, OrderEmpty, OrderProblem, OrderOffline): head with the round and count, the
// problem message, groups with their promise ("From the counter · Now", "Food together · 8:27 PM"), the footer with
// "All ready by", the total, Order note · Hold and the one primary button. Send stays on offline (it queues, 26d);
// it is off with an empty cart, a line problem ("Fix n item first") or a lock that does not let this person send.

export interface CartProps {
  config: BranchConfig;
  unitOf: UnitOf;
  utcOffsetMs: number;
  round: number | null;
  count: number;
  groups: Array<{ group: CartGroup; lines: LineView[] }>;
  /** null when a line's money is not known (menu data missing): "—" */
  total_minor: number | null;
  ready_by: number | null;
  problems: number;
  canSend: boolean;
  /** why Send is off besides problems (dine-in seating not found), or null */
  blocked: string | null;
  actions: LineActions;
  onNote(): void;
  onHold(): void;
  onSend(): void;
  /** phone / portrait: the list only (the sticky bar carries Send) */
  bare?: boolean;
}

function GroupHead({ group, utcOffsetMs }: { group: CartGroup; utcOffsetMs: number }) {
  if (group.kind === 'counter')
    return (
      <li className="grp">
        <Ico name="tray" />
        {t('cart.from_counter')}
        <span className="end">
          <b className="num">{t('cart.now')}</b>
        </span>
      </li>
    );
  if (group.kind === 'promise')
    return (
      <li className="grp">
        <Ico name="clock" />
        {t('cart.food_together')}
        <span className="end" dir="ltr">
          <b className="num">{timeText(group.promise_ms, utcOffsetMs)}</b>
        </span>
      </li>
    );
  return (
    <li className="grp">
      <Ico name="clock" />
      {t('cart.food_together')}
    </li>
  );
}

export function sendLabel(p: { problems: number }): string {
  return p.problems > 0 ? fill(t('cart.fix_first'), { n: String(p.problems) }) : t('cart.send');
}

export function CartList(p: Pick<CartProps, 'config' | 'unitOf' | 'utcOffsetMs' | 'groups' | 'actions'>) {
  return (
    <ul className="lines">
      {p.groups.length === 0 && (
        <li className="empty">
          <Ring size={80} pct={null} tone="mute">
            <Ico name="tray" />
          </Ring>
          <b>{t('cart.empty')}</b>
        </li>
      )}
      {p.groups.map(({ group, lines }, i) => [
        <GroupHead key={`g${i}`} group={group} utcOffsetMs={p.utcOffsetMs} />,
        ...lines.map((v) => <CartLineRow key={v.line.key} view={v} config={p.config} unitOf={p.unitOf} utcOffsetMs={p.utcOffsetMs} actions={p.actions} />),
      ])}
    </ul>
  );
}

export function Cart(p: CartProps) {
  const empty = p.count === 0;
  return (
    <aside className="cart">
      <div className="cart__head">
        <h2>
          {t('cart.title')}
          {p.round !== null && <span className="rnd2">· {fill(t('order.round'), { n: String(p.round) })}</span>}
        </h2>
        <span>{fill(t('cart.items'), { n: String(p.count) })}</span>
      </div>
      {p.blocked !== null && (
        <div className="msg cart__msg c-warn" role="alert">
          <Ico name="warn" />
          <span>{p.blocked}</span>
        </div>
      )}
      {p.problems > 0 && (
        <div className="msg cart__msg c-danger" role="alert">
          <Ico name="warn" />
          <span>{fill(t('cart.cant_send'), { n: String(p.problems) })}</span>
        </div>
      )}
      <CartList config={p.config} unitOf={p.unitOf} utcOffsetMs={p.utcOffsetMs} groups={p.groups} actions={p.actions} />
      <div className="cart__foot">
        <div className="total">
          <div className="total__ready">
            <Ring size={56} pct={null} tone={p.ready_by === null ? 'mute' : 'ok'}>
              <Ico name="clock" />
            </Ring>
            {p.ready_by === null ? (
              <div>{t('cart.times_later')}</div>
            ) : (
              <div>
                {t('cart.all_ready')}
                <b dir="ltr">{timeText(p.ready_by, p.utcOffsetMs)}</b>
              </div>
            )}
          </div>
          <strong dir={MONEY_DIR}>{p.total_minor === null ? '—' : money(p.total_minor)}</strong>
        </div>
        <div className="duo">
          <button type="button" className="btn" onClick={p.onNote}>
            {t('cart.note')}
          </button>
          <button type="button" className="btn" disabled={empty} onClick={p.onHold}>
            {t('cart.hold')}
          </button>
        </div>
        <button type="button" className="btn btn--primary btn--lg btn--block" disabled={empty || p.problems > 0 || !p.canSend} onClick={p.onSend}>
          <Ico name="send" />
          {sendLabel(p)}
        </button>
      </div>
    </aside>
  );
}

/** 02-S10 sticky Send bar: total, "6 items · 8:27 PM", Send. */
export function SendBar(p: Pick<CartProps, 'count' | 'total_minor' | 'ready_by' | 'utcOffsetMs' | 'problems' | 'canSend' | 'onSend'>) {
  const sub = fill(t('cart.items'), { n: String(p.count) }) + (p.ready_by === null ? '' : ` · ${timeText(p.ready_by, p.utcOffsetMs)}`);
  return (
    <div className="sbar">
      <div className="sbar__t">
        <b dir={MONEY_DIR}>{p.total_minor === null ? '—' : money(p.total_minor)}</b>
        <small>{sub}</small>
      </div>
      <button type="button" className="btn btn--primary btn--lg" disabled={p.count === 0 || p.problems > 0 || !p.canSend} onClick={p.onSend}>
        <Ico name="send" />
        {p.problems > 0 ? fill(t('cart.fix_first'), { n: String(p.problems) }) : t('cart.send_short')}
      </button>
    </div>
  );
}
