// owned by lane T, task 27a3 (was the W0.6 stub)
import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { useShell } from '../../shell/hooks';
import type { MapTile, OrdersPartProps, TableMapBody } from '../../tables/contracts';
import { CompItPrompt } from '../actions/CompItPrompt';
import { CompWaiting } from '../actions/CompWaiting';
import type { CompItSource } from '../actions/pending-comps';
import { sendAsNewItem } from '../actions/SendBackSheet';
import { useDrafts } from '../order-screen/OrderScreen';
import { onCompItSent, startCompItCart } from '../send/send';
import type { MarkServedPayload, OrdersCatchUp, SeatingLine, SeatingOrder, SeatingOrdersBody, SubmitOrderPayload } from '../contracts';
import { LateCard } from '../late/LateCard';
import { releasable } from '../late/ReleaseSheet';
import { lateCards, LateAlertsContext, type SlipRef } from '../late/late-groups';
import { money, MONEY_DIR } from '../money';
import { queueOf } from '../queue/enqueue';
import { LineActions, servedCandidatesOf, type LineOrder } from '../view/LineActions';
import { isWeightPending } from '../view/stage';
import { concerns, createLiveReader, idsOf, ORDER_FRAMES, SEATING_FRAMES, type LiveReader } from './refetch';
import { allServed, QueuedRound, Round } from './Round';
import { ZoneUndo } from './ZoneUndo';

// 02b v1.0.11 §8 Table view, Zone items, Late cards (02-S06 TableView*, ZoneUndo*, 02b-C04): the orders part of 02a's
// table sheet for one seating — late cards on top (O18 / Q-10), then "Orders · n orders · Rs total · + n to weigh",
// the rounds (by time and person, #36) and, on the selected line, its actions (27a1 / 27a2) and the zone Undo. The
// seating's orders come from `seating-orders`, read again on frames (Q-6, refetch.ts). Offline: rounds still in the
// device queue are drawn dashed "Waiting to send", Mark served queues, and the header says "Updated {time}".

/** E-7: the order screen (26d) announces each comp-it line once its round is sent or queued. */
const COMP_IT_SOURCE: CompItSource = { subscribe: onCompItSent };

const tilesOf = (body: unknown): MapTile[] => {
  const map = body as TableMapBody | undefined;
  return Array.isArray(map?.floors) ? map.floors.flatMap((f) => f.zones.flatMap((z) => z.tables)) : [];
};

export const OrdersPart = ({ seating_id, table_ids, primary_table_id, mine }: OrdersPartProps) => {
  const shell = useShell();
  const rows = useContext(LateAlertsContext);
  const drafts = useDrafts();
  /** the answer with the seating it is for: a seating change shows nothing of the old one, even for one render */
  const [read, setRead] = useState<{ seating_id: string; body: SeatingOrdersBody } | null>(null);
  const body = read !== null && read.seating_id === seating_id ? read.body : null;
  const [readAt, setReadAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [liveSlips, setLiveSlips] = useState<SlipRef[] | null>(null);
  /** warnings closed by an ItemsReleased frame since the catch-up */
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const known = useRef<{ orders: ReadonlySet<string>; lines: ReadonlySet<string> }>({ orders: new Set(), lines: new Set() });
  const reader = useRef<LiveReader | null>(null);
  const reread = useCallback(() => void reader.current?.read(), []);

  useEffect(() => {
    // another seating (split, merge): nothing of the old one stays on screen or is acted on
    setRead(null);
    setReadAt(null);
    setSelected(null);
    const caughtNow = shell.live.part('orders') as OrdersCatchUp | undefined;
    const seeded = (caughtNow?.orders ?? []).filter((o) => o.table_key === `dine_in:${seating_id}`);
    known.current = { orders: new Set(seeded.map((o) => o.order_id)), lines: new Set(seeded.flatMap((o) => o.lines.map((l) => l.order_item_id))) };
    let answered = false;
    const r = createLiveReader({
      live: shell.live,
      query: () => shell.orders.seatingOrders(seating_id),
      // a new order of this seating names an order this view does not know yet: OrderPlaced always counts
      relevant: (e) =>
        e.event_type === 'OrderPlaced' ||
        SEATING_FRAMES.has(e.event_type) ||
        // before the first answer every order frame counts (the mount read may be older than it, IR-6)
        (ORDER_FRAMES.has(e.event_type) && (!answered || concerns(e.payload, known.current.orders, known.current.lines))),
      onAnswer: (answer) => {
        if (!answer.ok) return;
        answered = true;
        known.current = {
          orders: new Set(answer.data.orders.map((o) => o.order_id)),
          lines: new Set(answer.data.orders.flatMap((o) => o.lines.map((l) => l.order_item_id))),
        };
        setRead({ seating_id, body: answer.data });
        setReadAt(shell.clock.nowMs());
      },
    });
    reader.current = r;
    void r.read();
    // H5 (Q-10): SlipWarned frames add late warnings between catch-ups; an ItemsReleased frame carrying a warning's
    // alert_id closes it (accept or ReleaseItems); a new catch-up's open_slips replaces what the frames added
    const offSlips = shell.live.subscribe((m) => {
      if (m.kind === 'catch_up') {
        setLiveSlips(null);
        setGone(new Set());
        return;
      }
      if (m.kind === 'event' && m.event.event_type === 'ItemsReleased') {
        const closed = m.event.payload['alert_id'];
        if (typeof closed === 'string') setGone((cur) => new Set([...cur, closed]));
        return;
      }
      if (m.kind !== 'event' || m.event.event_type !== 'SlipWarned') return;
      const alert_id = m.event.payload['alert_id'];
      if (typeof alert_id !== 'string') return;
      const slip = { alert_id, order_ids: idsOf(m.event.payload['order_ids']) };
      setLiveSlips((cur) => [...(cur ?? []).filter((s) => s.alert_id !== alert_id), slip]);
    });
    return () => {
      r.dispose();
      offSlips();
    };
  }, [seating_id, shell]);

  // the queue (offline rounds, queued Mark served) and the clock-driven lines repaint the part
  useEffect(() => shell.enqueue.subscribe(bump), [shell.enqueue]);
  const queue = queueOf(shell.enqueue);
  const queued = queue?.queued() ?? [];
  const queuedRounds = queued.filter((e) => e.command_type === 'SubmitOrder' && e.seating_id === seating_id);
  const queuedServed = new Set(queued.filter((e) => e.command_type === 'MarkServed').flatMap((e) => (e.payload as MarkServedPayload).lines.flatMap((l) => l.order_item_ids)));

  const tiles = tilesOf(shell.live.part('tables'));
  const names = table_ids.map((id) => tiles.find((x) => x.table_id === id)?.name ?? null).filter((x): x is string => x !== null);
  const ident = names.length > 0 ? names.join(' + ') : (tiles.find((x) => x.table_id === primary_table_id)?.name ?? '—');
  const caught = shell.live.part('orders') as OrdersCatchUp | undefined;
  const slips = caught?.open_slips === undefined && liveSlips === null ? undefined : [...(caught?.open_slips ?? []).filter((s) => !(liveSlips ?? []).some((x) => x.alert_id === s.alert_id)), ...(liveSlips ?? [])];

  const orders = useMemo(() => [...(body?.orders ?? [])].sort((a, b) => a.placed_at - b.placed_at), [body]);
  const may = shell.permissions.allowed;
  // the hub's RemoveItems needs take-order; the lock is the holder's, or take-order-anywhere's
  const canTakeOrder = may('take-order') && (mine || may('take-order-anywhere'));
  const offset = shell.clock.utcOffsetMs;
  const lineOrderOf = (o: SeatingOrder): LineOrder => ({
    order_id: o.order_id,
    order_type: 'dine_in',
    ident,
    billed: o.billed,
    lines: o.lines,
    seating_id,
    table_id: primary_table_id,
  });
  const lineOrders = orders.map(lineOrderOf);
  const candidates = orders.flatMap((o, i) => servedCandidatesOf(o.lines).map((c) => ({ ...c, round: fill(t('order.round'), { n: String(i + 1) }) })));
  const cards = lateCards({
    orders,
    slips,
    rows,
    placedAt: (id) => caught?.orders.find((o) => o.order_id === id)?.placed_at ?? null,
    tableNames: names,
    done: new Set([...answered, ...gone]),
  });

  // a grouped card whose orders have nothing left to send or hurry is resolved (the hub closes it with them)
  const shown = cards.filter((c) => c.mode !== 'grouped' || releasable(orders.filter((o) => c.order_ids.includes(o.order_id))).length > 0);
  const controls = (order: SeatingOrder) => (line: SeatingLine) => (
    <>
      <LineActions
        line={line}
        order={lineOrderOf(order)}
        servedCandidates={candidates}
        canTakeOrder={canTakeOrder}
        onChanged={reread}
        // E-7 "Send it as a new item": the seating's draft gets the item (26d startCompItCart), then the order screen
        onSendAsNew={(l) => void sendAsNewItem({ shell, start: startCompItCart, drafts, order: lineOrderOf(order), line: l })}
      />
      <ZoneUndo line={line} order={lineOrderOf(order)} canTakeOrder={canTakeOrder} onChanged={reread} />
      {queuedServed.has(line.order_item_id) && <span className="muted">{t('tv.queued_served')}</span>}
    </>
  );
  const below = (line: SeatingLine) => <CompWaiting line={line} onChanged={reread} />;
  const select = (id: string) => setSelected(selected === id ? null : id);
  const toWeigh = orders.flatMap((o) => o.lines).filter((l) => isWeightPending(l) && l.live_units > 0).length;
  const numberOf = new Map(orders.map((o, i) => [o.order_id, i + 1]));
  const open = orders.filter((o) => !allServed(o));
  const served = orders.filter((o) => allServed(o)).reverse();

  return (
    <>
      {shown.map((card) => (
        <LateCard
          key={card.key}
          model={card}
          ident={ident}
          orders={orders}
          receiverOf={rows.filter((r) => r.state === 'open').map((r) => r.alert_id)}
          onAnswered={(ids) => setAnswered((cur) => new Set([...cur, ...ids]))}
          onChanged={reread}
        />
      ))}
      <div className="tv__sec">
        <h3>{t('tv.orders')}</h3>
        <span className="end">
          {!shell.online && readAt !== null ? (
            fill(t('tv.updated'), { time: timeText(readAt, offset) })
          ) : body !== null && orders.length > 0 ? (
            <>
              {fill(t('tv.n_orders'), { n: String(orders.length) })} ·{' '}
              <b className="num" dir={MONEY_DIR}>
                {money(body.total_minor)}
              </b>
              {toWeigh > 0 && <small>{fill(t('tv.to_weigh'), { n: String(toWeigh) })}</small>}
            </>
          ) : null}
        </span>
      </div>
      {queuedRounds.map((e, i) => (
        <QueuedRound
          key={e.entry_id}
          payload={e.payload as SubmitOrderPayload}
          n={orders.length + i + 1}
          queuedAt={e.queued_at}
          by={e.staff_id === shell.me?.staff_id ? shell.me.name : null}
          config={shell.config.snapshot()}
          utcOffsetMs={offset}
        />
      ))}
      {[...open, ...served].map((o) => (
        <Round
          key={o.order_id}
          order={o}
          n={numberOf.get(o.order_id) ?? 0}
          utcOffsetMs={offset}
          selected={selected}
          onSelect={select}
          controls={controls(o)}
          below={below}
        />
      ))}
      <CompItPrompt seating_id={seating_id} orders={lineOrders} source={COMP_IT_SOURCE} onChanged={reread} />
    </>
  );
};
