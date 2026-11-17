// owned by lane T, task 27a1 (was the W0.6 stub)
import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../../../../app/router';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { BoostConfirm } from '../actions/BoostConfirm';
import { CompWaiting } from '../actions/CompWaiting';
import { ContactSheet } from '../actions/ContactSheet';
import { MarkServedSheet, type ServedCandidate } from '../actions/MarkServedSheet';
import type { CarType, CatchUpOrder, LineView, OpenOrder, OrdersCatchUp, OrderType, SeatingLine, SeatingOrder } from '../contracts';
import { MONEY_DIR, money } from '../money';
import { concerns, createLiveReader, idsOf, ORDER_FRAMES, type LiveReader } from '../table-view/refetch';
import { enqueueMeta, LineActions, servedCandidatesOf, showOrderError, type LineOrder } from './LineActions';
import { LineRow } from './LineRow';
import { isServed, readyCount } from './stage';

// 02b v1.0.11 §8 Table view, Open orders; §6.18a (frame 02b-S11 OrderView, Boost): one takeaway / parking order at
// #/orders/<order_id> — the token (or plate) big, Ready n/m, the promise, who placed it; Call / Boost / Mark served
// from the session's permissions (R5, Q-23); the lines with their stages and, on the selected line, its actions.
// The lines come from `order-view` (H3, Q-8). Until that route is on the hub (404 route → `missing`) the view shows the
// designed fallback: the catch-up lines with Served / Not served only, and the hub's answers decide.

export interface OrderViewProps {
  order_id: string;
}

/** The order's header data: the catch-up `orders` part (token, plate, customer name O17), else its open-orders row. */
interface Head {
  order_type: OrderType;
  /** `dine_in:<seating_id>` for a dine-in order (hub build-submit.ts) */
  table_key: string;
  token: number | null;
  car_number: string | null;
  car_type: CarType | null;
  customer_name: string | null;
  has_phone: boolean;
  placed_at: number;
  promise_ms: number | null;
  billed: boolean;
}

type View = { kind: 'loading' } | { kind: 'order'; order: SeatingOrder } | { kind: 'fallback' } | { kind: 'gone' };

const CAR: Record<CarType, 'order.parking.small' | 'order.parking.sedan' | 'order.parking.large'> = {
  mini: 'order.parking.small',
  sedan: 'order.parking.sedan',
  large: 'order.parking.large',
};

function headOfCatchUp(o: CatchUpOrder): Head {
  return {
    order_type: o.order_type,
    table_key: o.table_key,
    token: o.token,
    car_number: o.car_number,
    car_type: o.car_type,
    customer_name: o.customer_name ?? null,
    has_phone: o.has_phone,
    placed_at: o.placed_at,
    promise_ms: null,
    billed: o.billed,
  };
}

function headOfRow(o: OpenOrder): Head {
  return {
    order_type: o.order_type,
    table_key: o.table_key,
    token: o.token,
    car_number: o.car_number,
    car_type: o.car_type,
    customer_name: null,
    has_phone: o.has_phone,
    placed_at: o.placed_at,
    promise_ms: o.promise_ms,
    billed: false,
  };
}

export const identOf = (h: Pick<Head, 'token' | 'car_number'>): string => (h.car_number ?? (h.token === null ? '—' : String(h.token)));

export function OrderView({ order_id }: OrderViewProps) {
  const shell = useShell();
  const caught = (shell.live.part('orders') as OrdersCatchUp | undefined)?.orders.find((o) => o.order_id === order_id) ?? null;
  const [head, setHead] = useState<Head | null>(caught === null ? null : headOfCatchUp(caught));
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<'call' | 'boost' | 'served' | null>(null);

  /** Q-6 / IR-6 (table-view/refetch.ts): frame-driven re-reads; only the newest read answers */
  const lineIds = useRef<ReadonlySet<string>>(new Set((caught?.lines ?? []).map((l) => l.order_item_id)));
  /** the fallback has no read to repeat: lines served since the catch-up, from ItemServed frames */
  const [servedSince, setServedSince] = useState<ReadonlySet<string>>(new Set());
  const reader = useRef<LiveReader | null>(null);
  const load = useCallback(async () => {
    await reader.current?.read();
  }, []);

  useEffect(() => {
    const r = createLiveReader({
      live: shell.live,
      query: () => shell.orders.orderView(order_id),
      relevant: (e) => ORDER_FRAMES.has(e.event_type) && concerns(e.payload, new Set([order_id]), lineIds.current),
      onFrame: (e) => {
        if (e.event_type !== 'ItemServed') return;
        const served = idsOf(e.payload['order_item_ids']);
        setServedSince((cur) => new Set([...cur, ...served]));
      },
      onAnswer: (answer) => {
        if (answer.ok) {
          if (answer.data.kind === 'order') lineIds.current = new Set(answer.data.order.lines.map((l) => l.order_item_id));
          setView(answer.data.kind === 'order' ? { kind: 'order', order: answer.data.order } : { kind: 'fallback' });
        } else if (answer.error.kind === 'api' && answer.error.code === 'ORDER_NOT_FOUND') setView({ kind: 'gone' });
        else showOrderError(shell, answer.error, () => {});
      },
    });
    reader.current = r;
    void r.read();
    let alive = true;
    if (caught === null) {
      // placed after this page's catch-up: its token / plate from open-orders (one read)
      void shell.orders.openOrders({ order_type: 'all' }).then((answer) => {
        const row = answer.ok ? answer.data.orders.find((o) => o.order_id === order_id) : undefined;
        if (alive && row !== undefined) setHead(headOfRow(row));
      });
    }
    return () => {
      alive = false;
      r.dispose();
    };
    // one reader per order
  }, [order_id]);

  const close = () => navigate(shell.device.type === 'cashier_kiosk' ? '/' : '/orders');
  const offset = shell.clock.utcOffsetMs;
  const order = view.kind === 'order' ? view.order : null;
  const nowMs = shell.clock.nowMs();
  const fallbackLines: LineView[] =
    view.kind === 'fallback' ? (caught?.lines ?? []).map((l) => (l.served_at === null && servedSince.has(l.order_item_id) ? { ...l, served_at: nowMs } : l)) : [];
  const lines: LineView[] = order?.lines ?? fallbackLines;
  const ident = head === null ? '—' : identOf(head);
  const billed = order?.billed ?? head?.billed ?? false;
  const ready = readyCount(order?.lines ?? fallbackLines);
  const promise = order?.promise_ms ?? head?.promise_ms ?? null;
  const placedAt = order?.placed_at ?? head?.placed_at ?? null;
  const placer = order?.placed_by.name ?? null;
  const seatingLine = (l: LineView): SeatingLine | null => order?.lines.find((x) => x.order_item_id === l.order_item_id) ?? null;
  const total = lines.reduce((sum, l) => sum + l.billed_minor, 0);

  const title =
    head === null
      ? ''
      : head.order_type === 'parking'
        ? head.car_type === null
          ? t('order.parking')
          : fill(t('ov.parking_car'), { car: t(CAR[head.car_type]) })
        : head.order_type === 'takeaway'
          ? head.customer_name === null || head.customer_name === ''
            ? t('order.takeaway')
            : fill(t('ov.takeaway_name'), { name: head.customer_name })
          : t('order.your_table');
  const what = head === null ? ident : `${t(head.order_type === 'parking' ? 'order.parking' : 'order.takeaway')} · ${ident}`;

  const candidates: ServedCandidate[] =
    order !== null
      ? servedCandidatesOf(order.lines)
      : fallbackLines.filter((l) => l.line_kind !== 'deal' && l.live_units > 0 && !isServed(l)).map((line) => ({ line, stage: null, ready: false }));
  const may = shell.permissions.allowed;
  const showCall = head !== null && head.order_type !== 'dine_in' && head.has_phone && may('view-customer-contact');
  const showBoost = may('boost-order') && !billed && view.kind !== 'gone';
  const showServed = may('mark-served') && candidates.length > 0;
  const acts = [showCall, showBoost, showServed].filter(Boolean).length;

  const lineOrder: LineOrder | null =
    order === null || head === null
      ? null
      : {
          order_id,
          order_type: head.order_type,
          ident,
          billed,
          lines: order.lines,
          // a dine-in RemoveItems names the seating (§6.2); the hub answers TABLE_SEATING_CHANGED if it moved
          ...(head.order_type === 'dine_in' && head.table_key.startsWith('dine_in:') ? { seating_id: head.table_key.slice('dine_in:'.length) } : {}),
        };

  return (
    <div className={shell.phone ? 'scrim scrim--sheet' : 'scrim scrim--side'}>
      <section className="tv" role="dialog" aria-modal="true" aria-label={title}>
        <div className="tv__h">
          <div className="tv__hd">
            {head?.car_number !== null && head?.car_number !== undefined ? (
              <span className="tcode" dir="ltr">
                <span className="plate">{head.car_number}</span>
              </span>
            ) : (
              <span className="tcode" dir="ltr">
                {ident}
              </span>
            )}
            <div className="tv__t">
              <h2 dir="auto">{title}</h2>
              <div className="tv__m">
                {ready.m > 0 && (
                  <span className={`stg ${ready.n === ready.m ? 'c-ok' : 'c-mute'}`}>
                    <Ico name="checkc" />
                    {fill(t('orders.ready'), { n: String(ready.n), m: String(ready.m) })}
                  </span>
                )}
                {promise !== null && (
                  <span className="i">
                    <Ico name="clock" />
                    {t('ov.promise')} <b className="num">{timeText(promise, offset)}</b>
                  </span>
                )}
                {placedAt !== null && (
                  <span className="i">
                    {placer === null
                      ? fill(t('ov.placed'), { time: timeText(placedAt, offset) })
                      : fill(t('ov.placed_by'), { time: timeText(placedAt, offset), name: placer })}
                  </span>
                )}
              </div>
            </div>
            <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={close}>
              <Ico name="x" />
            </button>
          </div>
          {acts > 0 && (
            <div className={acts === 3 ? 'tv__acts tv__acts--3' : 'tv__acts'}>
              {showCall && (
                <button type="button" className="btn btn--act" onClick={() => setOpen('call')}>
                  <Ico name="hand" />
                  {t('ov.call')}
                </button>
              )}
              {showBoost && (
                <button type="button" className="btn btn--act" aria-expanded={open === 'boost'} onClick={() => setOpen(open === 'boost' ? null : 'boost')}>
                  <Ico name="pulse" />
                  {t('ov.boost')}
                </button>
              )}
              {showServed && (
                <button type="button" className="btn btn--act" onClick={() => setOpen('served')}>
                  <Ico name="check" />
                  {t('served.title')}
                </button>
              )}
            </div>
          )}
          {open === 'boost' && <BoostConfirm order_id={order_id} ident={ident} onClose={() => setOpen(null)} onChanged={() => void load()} />}
        </div>
        <div className="tv__b">
          {view.kind === 'gone' && (
            <div className="ro">
              <Ico name="info" />
              <span>{t('line.err.gone')}</span>
            </div>
          )}
          {view.kind === 'fallback' && (
            <div className="ro">
              <Ico name="info" />
              <span>{t('orders.stage_gap')}</span>
            </div>
          )}
          {lines.length > 0 && (
            <div className="rnd">
              {lines.map((line) => (
                <LineRow
                  key={line.order_item_id}
                  line={line}
                  mode={order === null ? 'served' : 'stages'}
                  utcOffsetMs={offset}
                  selected={selected === line.order_item_id}
                  {...(lineOrder === null ? {} : { onSelect: (id: string) => setSelected(selected === id ? null : id) })}
                  below={<CompWaiting line={line} onChanged={() => void load()} />}
                >
                  {lineOrder !== null && seatingLine(line) !== null && (
                    <LineActions line={seatingLine(line)!} order={lineOrder} onChanged={() => void load()} />
                  )}
                </LineRow>
              ))}
            </div>
          )}
          {lines.length > 0 && (
            <div className="tv__sec">
              <h3>{t('ov.total')}</h3>
              <span className="end">
                <b className="num" dir={MONEY_DIR}>
                  {money(total)}
                </b>
              </span>
            </div>
          )}
        </div>
      </section>
      {open === 'call' && <ContactSheet order_id={order_id} what={what} onClose={() => setOpen(null)} />}
      {open === 'served' && (
        <MarkServedSheet
          ident={ident}
          candidates={candidates}
          meta={(label) => enqueueMeta({}, label)}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            void load();
          }}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
