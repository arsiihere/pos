import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import type { OpenOrder } from '../contracts';

// 02b v1.0.11 §8 Open orders, §6.16 (frame 02-S07 OpenOrdersKiosk / OpenOrdersAbandoned / OpenOrdersPhone): one row.
// Token tile (takeaway) or plate tile (parking), type + who + phone mark, Ready n/m pill, promise. A ready row is
// green; "from 6 Nov" on a carried order. Status is icon + word + colour (never colour alone).

/** The few glyphs the 01d icon set has no shape for (same 24-box line style as alerts/ui.tsx `Ico`). */
function Glyph({ d }: { d: string[] }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}
const PHONE = ['M6 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4 5.5a2 2 0 0 1 2-2z'];
const BAG = ['M5 8h14l-1 12H6z', 'M9 8V6.5a3 3 0 0 1 6 0V8'];
const CAR = ['M4 16v-4l2-5h12l2 5v4z', 'M4 16h16', 'M7.5 19.5v.01', 'M16.5 19.5v.01'];
const TABLE = ['M4 9h16', 'M6 9v10', 'M18 9v10', 'M3 9l1.5-4h15L21 9'];

const CAR_TYPE: Record<string, 'order.parking.small' | 'order.parking.sedan' | 'order.parking.large'> = {
  mini: 'order.parking.small',
  sedan: 'order.parking.sedan',
  large: 'order.parking.large',
};

/** What the screen worked out for the row beyond the hub's fields (names, table); all optional. */
export interface RowFacts {
  /** the customer's name (kiosk and placer only, O17) */
  customer: string | null;
  /** who placed it */
  placer: string | null;
  /** the dine-in row's current table, or null → "Table" */
  table: string | null;
  /** "No kitchen tap for {n} h" hours, from order_abandon_ms, or null */
  tapHours: number | null;
}

export interface OpenOrdersRowProps {
  order: OpenOrder;
  facts: RowFacts;
  utcOffsetMs: number;
  onOpen: () => void;
}

/** "6 Nov" of a hub-clock instant in the hub zone. */
export function dayText(ms: number, utcOffsetMs: number): string {
  const d = new Date(ms + utcOffsetMs);
  const month = t('alerts.months').split(',')[d.getUTCMonth()] ?? '';
  return `${d.getUTCDate()} ${month}`;
}

/** "from 6 Nov" for a carried order (`from_date` = YYYY-MM-DD), else null. */
export function fromText(from: string | null): string | null {
  if (from === null) return null;
  const [, month, date] = from.split('-').map(Number);
  const name = t('alerts.months').split(',')[(month ?? 1) - 1] ?? '';
  return fill(t('orders.from_date'), { date: `${date ?? ''} ${name}` });
}

function placedLine(o: OpenOrder, f: RowFacts, utcOffsetMs: number): string {
  // a carried order names its day: "Placed 6 Nov 11:40 PM"
  const when = `${o.from_date === null ? '' : `${dayText(o.placed_at, utcOffsetMs)} `}${timeText(o.placed_at, utcOffsetMs)}`;
  if (f.customer !== null && f.customer !== '') return fill(t('orders.named'), { name: f.customer, time: when });
  if (f.placer !== null) return fill(t('orders.placed_by'), { time: when, who: f.placer });
  return fill(t('orders.placed'), { time: when });
}

export function OpenOrdersRow({ order: o, facts, utcOffsetMs, onOpen }: OpenOrdersRowProps) {
  const dineIn = o.order_type === 'dine_in';
  const parking = o.order_type === 'parking';
  const ready = !dineIn && o.ready.m > 0 && o.ready.n >= o.ready.m;
  const from = fromText(o.from_date);
  const idClass = parking ? 'oo__id p' : dineIn ? 'oo__id' : 'oo__id num';
  const type = dineIn
    ? t('orders.dine_in')
    : parking
      ? `${t('order.parking')}${o.car_type === null ? '' : ` · ${t(CAR_TYPE[o.car_type] ?? 'order.parking.sedan')}`}`
      : t('order.takeaway');
  return (
    <button type="button" className={`oo${ready ? ' ready' : ''}`} data-order={o.order_id} onClick={onOpen}>
      <span className={idClass}>
        {parking ? (
          <span className="plate" dir="ltr">
            {o.car_number ?? ''}
          </span>
        ) : dineIn ? (
          (facts.table ?? t('orders.table'))
        ) : (
          (o.token ?? '')
        )}
      </span>
      <span className="oo__m">
        <b>
          <Glyph d={dineIn ? TABLE : parking ? CAR : BAG} />
          {type}
          {from !== null && (
            <span className="bdg c-warn">
              <Ico name="clock" />
              {from}
            </span>
          )}
        </b>
        <small>
          {dineIn
            ? [facts.tapHours === null ? null : fill(t('orders.no_tap'), { n: String(facts.tapHours) }), facts.placer].filter((x) => x !== null).join(' · ')
            : placedLine(o, facts, utcOffsetMs)}
          {!dineIn && o.has_phone && <Glyph d={PHONE} />}
        </small>
      </span>
      {dineIn ? (
        <span className="stg c-mute">
          <Ico name="eye" />
          {t('stage.not_tracked')}
        </span>
      ) : (
        <span className={`stg ${ready ? 'c-ok' : 'c-mute'}`}>
          <Ico name={ready ? 'checkc' : 'clock'} />
          {fill(t('orders.ready'), { n: String(o.ready.n), m: String(o.ready.m) })}
        </span>
      )}
      <span className="oo__r">
        <b className="num">{dineIn ? '—' : o.promise_ms === null ? '—' : timeText(o.promise_ms, utcOffsetMs)}</b>
        <small>{dineIn ? t('orders.opens_table') : t('orders.promise')}</small>
      </span>
    </button>
  );
}
