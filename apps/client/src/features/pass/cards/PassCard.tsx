import { useEffect, useReducer, useRef, type ReactNode } from 'react';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { timeText } from '../../alerts/labels';
import { onSlotsChanged, passCardActions, runSlotAction } from '../../kds/slots';
import { dayLabel } from '../../kds/station/Identifier';
import type { PointLine, PointOrder, PointStation } from '../contracts';
import { LineRow } from './LineRow';
import { readiness } from './readiness';

// 03b v1.0.8 §3.4 (#74, Q-47, Q-50; P2; frames 03b-S02 Pass / PassRush / PassUrdu, 03b-C10 / C12 PassCards): one card
// per order. Header: the identifier (LTR; a token with its day, a parking plate with the car type), "placed {time}"
// (12-hour, hub zone) and the readiness pill (Ready / HOLD AT PASS / Cooking; none when everything is handed over).
// The order note, then the lines grouped by station in the point's station order ("{station} · no screen" for a
// screenless one), folded after 7 lines when there are more than 8 ("+n more lines"). Then what P3 adds (`band`: the
// Ready band and card messages; `buttons`: Ready to serve / Hand over; `lineActions`: screenless Start / Done), and the
// 03c card actions (Reprint, `btn rp`). The card re-renders on notifySlots (03c's printed set, ticket cache); a slot
// action runs once per tap (ref guard) and its toast goes to the page's toast bus; every button is off while offline.

const SHOWN = 7;
const FOLD_AFTER = 8;

const PILL = {
  ready: { cls: 'rd c-ok solid', key: 'pass.ready', icon: <path d="M5 12.5l4.5 4.5L19 7.5" /> },
  sent: { cls: 'rd c-ok solid', key: 'pass.ready', icon: <path d="M5 12.5l4.5 4.5L19 7.5" /> },
  hold: {
    cls: 'rd c-warn',
    key: 'pass.hold',
    icon: (
      <>
        <rect x="6.5" y="5" width="3.5" height="14" rx="1" />
        <rect x="14" y="5" width="3.5" height="14" rx="1" />
      </>
    ),
  },
  cooking: {
    cls: 'rd c-mute',
    key: 'pass.cooking',
    icon: <path d="M12 21c-4 0-6.5-2.6-6.5-6.2 0-3.6 2.8-5.6 4-8.8 2.2 1.4 2.8 3.6 2.6 5.4 1.2-.4 2-1.6 2.2-3 2 1.8 2.2 4.2 2.2 6.4C16.5 18.4 15 21 12 21z" />,
  },
} as const;

export interface PassCardProps {
  order: PointOrder;
  stations: readonly PointStation[];
  pointId: string;
  utcOffsetMs: number;
  /** the socket is up; every button is off when not */
  up: boolean;
  /** P3: the Ready band and the card's messages, between the lines and the footer */
  band?: ReactNode;
  /** P3: Ready to serve / Hand over, in the footer before the slot actions */
  buttons?: ReactNode[];
  /** P3: a line's own actions (Start / Done on a screenless station) */
  lineActions?: (line: PointLine) => ReactNode;
  onToast?: (text: string, tone?: 'ok' | 'warn') => void;
}

function Ident({ order }: { order: PointOrder }) {
  const id = order.identifier;
  if (id.kind === 'parking') {
    return (
      <span className="pc__n">
        <span className="plt">{id.car_number}</span>
        <small>{t(`kds.car.${id.car_type}`)}</small>
      </span>
    );
  }
  if (id.kind === 'token') {
    return (
      <span className="pc__n">
        #{id.token}
        {id.date !== null && <small>{dayLabel(id.date)}</small>}
      </span>
    );
  }
  return <span className="pc__n">{id.label}</span>;
}

/** "placed {time}" with the time in a `.num` span (LTR inside an Urdu sentence) */
function Placed({ ms, utcOffsetMs }: { ms: number; utcOffsetMs: number }) {
  const [before, after = ''] = t('pass.placed').split('{time}');
  return (
    <span className="pc__m">
      {before}
      <span className="num">{timeText(ms, utcOffsetMs)}</span>
      {after}
    </span>
  );
}

export function PassCard({ order, stations, pointId, utcOffsetMs, up, band, buttons = [], lineActions, onToast }: PassCardProps) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onSlotsChanged(rerender), []);
  const running = useRef(new Set<string>());

  const r = readiness(order);
  const pill = r.state === 'none' ? null : PILL[r.state];
  const note = order.lines.find((l) => l.order_note !== null)?.order_note ?? null;

  // lines by station, in the point's station order (an unknown station last, in line order)
  const rank = new Map(stations.map((s, i) => [s.station_id, i]));
  const groups: Array<{ station_id: string; lines: PointLine[] }> = [];
  for (const l of order.lines) {
    const g = groups.find((x) => x.station_id === l.station_id);
    if (g === undefined) groups.push({ station_id: l.station_id, lines: [l] });
    else g.lines.push(l);
  }
  groups.sort((a, b) => (rank.get(a.station_id) ?? stations.length) - (rank.get(b.station_id) ?? stations.length));
  const total = order.lines.length;
  let budget = total > FOLD_AFTER ? SHOWN : total;
  const shown = groups.flatMap((g) => {
    if (budget <= 0) return [];
    const lines = g.lines.slice(0, budget);
    budget -= lines.length;
    return [{ ...g, lines }];
  });

  const slot = passCardActions({ order_id: order.order_id, point_id: pointId });
  const run = (key: string, action: (typeof slot)[number]) => {
    if (running.current.has(key)) return;
    running.current.add(key);
    runSlotAction(action).then(
      (res) => {
        running.current.delete(key);
        if (res.toast !== undefined) onToast?.(res.toast);
      },
      () => {
        running.current.delete(key);
        onToast?.(t('errors.UNKNOWN'), 'warn');
      },
    );
  };
  const footer = buttons.length + slot.length > 0;

  return (
    <article className={r.state === 'ready' || r.state === 'hold' || r.state === 'sent' ? `pc ${r.state}` : 'pc'} data-order={order.order_id}>
      <div className="pc__h">
        <div className="pc__id">
          <Ident order={order} />
          <Placed ms={order.placed_at} utcOffsetMs={utcOffsetMs} />
        </div>
        {pill !== null && (
          <span className={pill.cls}>
            <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
              {pill.icon}
            </svg>
            {t(pill.key)}
          </span>
        )}
      </div>
      {note !== null && (
        <div className="pc__on">
          <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 4h10l4 4v12H5z" />
            <path d="M15 4v4h4" />
            <path d="M8.5 12.5h7" />
            <path d="M8.5 16h5" />
          </svg>
          <span>{note}</span>
        </div>
      )}
      <div className="pc__ls">
        {shown.map((g) => {
          const st = stations.find((s) => s.station_id === g.station_id);
          const name = st?.name ?? '';
          return [
            <div key={`g-${g.station_id}`} className="pc__g">
              {st?.screenless === true ? fill(t('pass.group_no_screen'), { station: name }) : name}
            </div>,
            ...g.lines.map((l) => <LineRow key={l.order_item_id} line={l} actions={lineActions?.(l)} />),
          ];
        })}
        {total > FOLD_AFTER && <div className="pc__more">{fill(t('pass.more_lines'), { n: String(total - SHOWN) })}</div>}
      </div>
      {band}
      {footer && (
        <div className={buttons.length <= 1 ? 'pc__f pc__f--1' : 'pc__f'}>
          {buttons}
          {slot.map((a) => (
            <button key={a.key} type="button" className="btn rp" disabled={!up} onClick={() => run(a.key, a)}>
              <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 9V3.5h10V9" />
                <rect x="3.5" y="9" width="17" height="8" rx="2" />
                <path d="M7 14.5h10V21H7z" />
              </svg>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
