import { useState, type ReactNode } from 'react';
import type { BranchConfig } from '@pos/events';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import type { SeatingLine, SeatingOrder, SubmitOrderPayload } from '../contracts';
import { MONEY_DIR, money } from '../money';
import { cartLineMoney, configUnits, type CartLine } from '../order-screen/cart';
import { LineRow } from '../view/LineRow';
import { isServed } from '../view/stage';

// 02b v1.0.11 §8 Table view (02-S06 TableView, TableViewOffline; E2-ADD AC4; #36): one round = one order, headed by
// its number, time and person, the order note (Q-7; none until H2) and its promise as a clock time ("Food at 8:29
// PM"). A round whose lines are all served folds to "Served · n items" (tap to open). A round still in the device
// queue is drawn dashed with "Waiting to send" (§3.12; the cart is frozen, its lines from the queued payload).

export interface RoundProps {
  order: SeatingOrder;
  n: number;
  utcOffsetMs: number;
  selected: string | null;
  onSelect(order_item_id: string): void;
  /** the selected line's controls */
  controls(line: SeatingLine): ReactNode;
  /** always under a line (the comp waiting card) */
  below(line: SeatingLine): ReactNode;
}

/** Parents first, each followed by its option children / deal parts, in the hub's order. */
export function linesInOrder(lines: readonly SeatingLine[]): SeatingLine[] {
  const out: SeatingLine[] = [];
  const children = (id: string) => lines.filter((l) => l.parent_order_item_id === id);
  for (const top of lines.filter((l) => l.parent_order_item_id === null)) out.push(top, ...children(top.order_item_id));
  // a child whose parent is not in the list still shows
  for (const l of lines) if (!out.includes(l)) out.push(l);
  return out;
}

export const allServed = (order: SeatingOrder): boolean => {
  const counted = order.lines.filter((l) => l.line_kind !== 'deal' && l.live_units > 0);
  return counted.length > 0 && counted.every((l) => isServed(l));
};

export function Round({ order, n, utcOffsetMs, selected, onSelect, controls, below }: RoundProps) {
  const done = allServed(order);
  const [open, setOpen] = useState(false);
  const folded = done && !open;
  const items = order.lines.filter((l) => l.parent_order_item_id === null && l.live_units > 0).length;
  const note = order.order_note ?? null;
  return (
    <div className={order.cancelled ? 'rnd cx' : 'rnd'} data-order={order.order_id}>
      <div className="rnd__h" {...(done ? { role: 'button', tabIndex: 0, 'aria-expanded': open, onClick: () => setOpen(!open) } : {})}>
        <b>{fill(t('order.round'), { n: String(n) })}</b>
        <span className="m">
          <span className="num">{timeText(order.placed_at, utcOffsetMs)}</span>
          {order.placed_by.name !== null && (
            <>
              {' · '}
              <b>{order.placed_by.name}</b>
            </>
          )}
        </span>
        {note !== null && note !== '' && (
          <span className="m" dir="auto">
            “{note}”
          </span>
        )}
        <span className="end">
          {done ? (
            <>
              <span className="stg c-mute">
                <Ico name="check" />
                {t('orders.served')}
              </span>
              <span className="m">{fill(t('cart.items'), { n: String(items) })}</span>
              <Ico name={open ? 'down' : 'chev'} />
            </>
          ) : (
            order.promise_ms !== null && (
              <span className="eta">
                <Ico name="clock" />
                {fill(t('tv.food_at'), { time: timeText(order.promise_ms, utcOffsetMs) })}
              </span>
            )
          )}
        </span>
      </div>
      {!folded &&
        linesInOrder(order.lines).map((line) => (
          <LineRow
            key={line.order_item_id}
            line={line}
            mode="stages"
            utcOffsetMs={utcOffsetMs}
            selected={selected === line.order_item_id}
            onSelect={onSelect}
            below={below(line)}
          >
            {controls(line)}
          </LineRow>
        ))}
    </div>
  );
}

/**
 * A queued round's lines: names from the branch menu, amounts from the order screen's cart money
 * (`cartLineMoney`, @pos/domain integer minor units, as the hub's buildSubmit prices them — frame TableViewOffline
 * "Rs 40"); a line the menu no longer knows, or a weight still to enter, shows "—".
 */
function queuedLines(config: BranchConfig | null, payload: SubmitOrderPayload): Array<{ key: string; name: string; quantity: number | null; minor: number | null }> {
  return payload.lines.map((l) => {
    const item = l.item_id === undefined ? undefined : config?.items.find((i) => i.item_id === l.item_id);
    const deal = l.deal_id === undefined ? undefined : config?.deals.find((d) => d.deal_id === l.deal_id);
    const piece = item === undefined || item.sale_unit === 'piece';
    const cartLine: CartLine = {
      key: l.order_item_id,
      ...(l.item_id === undefined ? {} : { item_id: l.item_id }),
      ...(l.deal_id === undefined ? {} : { deal_id: l.deal_id }),
      quantity: l.quantity ?? (piece ? 1 : null),
      options: (l.options ?? []).map((o) => ({ option_id: o.option_id, quantity: o.quantity, ...(o.order_item_id === undefined ? {} : { order_item_id: o.order_item_id }) })),
      ...(l.deal_choices === undefined ? {} : { deal_choices: l.deal_choices }),
    };
    const m = config === null ? null : cartLineMoney(config, cartLine, configUnits(config));
    return { key: l.order_item_id, name: item?.name ?? deal?.name ?? '—', quantity: piece ? (l.quantity ?? 1) : null, minor: m !== null && m.kind === 'ok' ? m.minor : null };
  });
}

export function QueuedRound({ payload, n, queuedAt, by, config, utcOffsetMs }: { payload: SubmitOrderPayload; n: number; queuedAt: number; by: string | null; config: BranchConfig | null; utcOffsetMs: number }) {
  return (
    <div className="rnd q" data-queued={payload.order_id}>
      <div className="rnd__h">
        <b>{fill(t('order.round'), { n: String(n) })}</b>
        <span className="m">
          <span className="num">{timeText(queuedAt, utcOffsetMs)}</span>
          {by !== null && (
            <>
              {' · '}
              <b>{by}</b>
            </>
          )}
        </span>
        <span className="end">
          <span className="stg c-warn">
            <Ico name="send" />
            {t('tables.flag.waiting_to_send')}
          </span>
        </span>
      </div>
      {queuedLines(config, payload).map((l) => (
        <div key={l.key} className="ol">
          <span className="ol__q num">{l.quantity ?? 1}×</span>
          <span className="ol__n">
            <b>{l.name}</b>
          </span>
          <span className="ol__e">
            <span className="ol__p" dir={MONEY_DIR}>
              {l.minor === null ? '—' : money(l.minor)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
