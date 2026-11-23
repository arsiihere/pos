import type { LineDetail } from '@pos/domain';
import type { WsServerMessage } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../../../test/dom';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { PassCard } from './cards/PassCard';
import { groupLines, passRounds } from './cards/parts';
import type { PointLine, PointOrder, PointStation, PointViewBody } from './contracts';
import { createPassStore } from './store';

// 03b v1.0.14 §3.4 (STAB-6, STAB-7; 03a v1.2.10 To 03b #9, #10): a Pass card groups split parts by part_of + stage +
// hand-over + load_id, so each batch round is its own row with the §3.3 round tag; the pick sheet steps per row; a
// priority line shows "Priority · n min late" (n only from the hub's view; a LinePrioritized frame shows "Priority");
// the card order is unchanged. Tests 95 (Pass part), 96.

const PT = 'PT';
const MIN = 60_000;

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id: 'ST-T',
    point_id: PT,
    identifier: { kind: 'table', label: 'T4' },
    order_type: 'dine_in',
    item_name: 'Naan',
    units: 1,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 3 * MIN,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    ...over,
  };
}
const line = (id: string, stage: PointLine['stage'], over: Partial<PointLine> = {}, d: Partial<LineDetail> = {}): PointLine => ({
  ...detail(id, d),
  stage,
  handed_over: false,
  ...over,
});
const order = (order_id: string, lines: PointLine[]): PointOrder => ({ order_id, identifier: { kind: 'table', label: 'T4' }, placed_at: 1_000, lines, ready: null });
const STATIONS: PointStation[] = [{ station_id: 'ST-T', name: 'Tandoor', lanes: { lanes_on: 1, lane_count: 1 }, dark: false }];

const N = ['N', 'N-p2', 'N-p3', 'N-p4', 'N-p5', 'N-p6', 'N-p7', 'N-p8', 'N-p9', 'N-p10'];
const naan = (): PointLine[] =>
  N.map((id, i) => line(id, i < 3 ? 'cooking' : 'added', { load_id: i < 3 ? 'ST-T:L1' : 'ST-T:L2', started_at: i < 3 ? 1_000 : null }, { part_of: 'N' }));

let m: Mounted;
afterEach(() => m?.unmount());
const rows = () => [...m.container.querySelectorAll<HTMLElement>('.pc .pl')];
const itemText = (el: Element) => el.querySelector('.pl__t')?.textContent;
const roundOf = (el: Element) => el.querySelector('[data-round]')?.textContent ?? null;
const chipOf = (el: Element) => el.querySelector('.kmk--prio')?.textContent ?? null;

describe('[03b v1.0.14 §3.4, #96] Pass rows per round and the priority chip (STAB-6, STAB-7)', () => {
  it('[#96] a card with batch parts in two loads shows two rows with the round tags', () => {
    const o = order('O1', naan());
    m = mount();
    m.render(<PassCard order={o} stations={STATIONS} pointId={PT} utcOffsetMs={0} up rounds={passRounds([o])} />);
    expect(rows().map((r) => [itemText(r), roundOf(r)])).toEqual([
      ['3 xNaan', t('kds.round.this')],
      ['7 xNaan', t('kds.round.next')],
    ]);
  });

  it('[#96] the pick sheet / hand-over grouping counts per row (one row per load); without load_id the parts stay one row', () => {
    expect(groupLines(naan().map((l) => ({ ...l, stage: 'done' as const }))).map((r) => r.parts.length)).toEqual([3, 7]);
    expect(groupLines(naan().map((l) => ({ ...l, stage: 'done' as const, load_id: null }))).map((r) => r.parts.length)).toEqual([10]);
  });

  it('[#96] the round is station-wide over the point: another order\'s later load reads "round 3"', () => {
    const a = order('O1', naan());
    const b = order('O2', [line('X', 'added', { load_id: 'ST-T:L3' }, { order_id: 'O2' })]);
    expect([...passRounds([a, b]).entries()]).toEqual([
      ['ST-T:L1', t('kds.round.this')],
      ['ST-T:L2', t('kds.round.next')],
      ['ST-T:L3', fill(t('kds.round.n'), { n: '3' })],
    ]);
  });

  it('[#96] a priority line shows the chip on its row ("Priority" alone at 0); a grouped row takes the largest n', () => {
    const o = order('O1', [
      line('A', 'added', { priority: { since_ms: MIN, minutes_late: 6 } }, { item_name: 'Karahi' }),
      line('B', 'added', { priority: { since_ms: MIN, minutes_late: 0 } }, { item_name: 'Daal' }),
      line('G', 'added', {}, { part_of: 'G', item_name: 'Roti' }),
      line('G-p2', 'added', { priority: { since_ms: MIN, minutes_late: 2 } }, { part_of: 'G', item_name: 'Roti' }),
    ]);
    m = mount();
    m.render(<PassCard order={o} stations={STATIONS} pointId={PT} utcOffsetMs={0} up />);
    expect(rows().map(chipOf)).toEqual([fill(t('kds.priority'), { n: '6' }), t('kds.priority_short'), fill(t('kds.priority'), { n: '2' })]);
  });

  it('[#95 (Pass); m-6] a LinePrioritized frame sets "Priority" with no minutes on a held line; an id not held is ignored; Start drops it; the card order is unchanged', () => {
    const store = createPassStore({ now: () => 2 * MIN });
    const v: PointViewBody = {
      point_id: PT,
      stations: STATIONS,
      orders: [order('O1', [line('A', 'added')]), order('O2', [line('B', 'added', {}, { order_id: 'O2' })])],
      takeovers: [],
    };
    store.apply({ type: 'catch_up', as_of_seq: 1, state: { point_view: v } } as WsServerMessage);
    const ev = (event_type: string, payload: Record<string, unknown>): WsServerMessage => ({ type: 'event', seq: 5, event: { event_id: `E-${event_type}`, event_type, schema_version: 1, payload } });
    store.apply(ev('LinePrioritized', { order_id: 'O2', group_id: 'O2:0', order_item_ids: ['B', 'NOPE'], delay_ms: 7 * MIN, at_ms: MIN }));
    const lines = () => store.snapshot().view!.orders.flatMap((o) => o.lines);
    expect(store.snapshot().view!.orders.map((o) => o.order_id)).toEqual(['O1', 'O2']);
    expect(lines().find((l) => l.order_item_id === 'B')!.priority).toEqual({ minutes_late: null });
    expect(lines().find((l) => l.order_item_id === 'A')!.priority ?? null).toBeNull();
    m = mount();
    m.render(<PassCard order={store.snapshot().view!.orders[1]!} stations={STATIONS} pointId={PT} utcOffsetMs={0} up />);
    expect(rows().map(chipOf)).toEqual([t('kds.priority_short')]);
    store.apply(ev('ItemStarted', { order_item_id: 'B', started_at: 2 * MIN, source: 'tap' }));
    expect(lines().find((l) => l.order_item_id === 'B')!.priority).toBeNull();
  });
});
