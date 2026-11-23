import type { LineDetail } from '@pos/domain';
import type { KdsStationBody, StationPlanBody, WsServerMessage } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { fakeTimers } from '../alerts/test-fakes';
import type { KdsApi } from './contracts';
import { useKdsActions } from './actions/actions';
import { RowActions } from './actions/DoneEarly';
import { StationView } from './station/StationView';
import { createKdsStore, type KdsView } from './store';

// 03b v1.0.14 §3.3 (STAB-6, STAB-7; 03a v1.2.10 To 03b #9, #10): at a batch station a split line's parts in different
// loads are different rows with a station-wide round tag; a priority line shows "Priority · n min late" (n only from
// the engine view; a LinePrioritized frame shows "Priority" alone); rows on screen never move; a new Next row is
// appended at the bottom. Tests 93, 94, 95 (KDS part).

const ST = 'ST-TANDOOR';
const MIN = 60_000;

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id: ST,
    point_id: 'P1',
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
type NowLine = KdsStationBody['now'][number];
type PlanLine = StationPlanBody['lines'][number];
const nowLine = (id: string, over: Partial<NowLine> = {}, d: Partial<LineDetail> = {}): NowLine => ({
  ...detail(id, d),
  stage: 'added',
  fired_at: 1_000,
  started_at: null,
  mark: null,
  done_undone: false,
  ...over,
});
const planLine = (id: string, over: Partial<PlanLine> = {}): PlanLine => ({ order_item_id: id, order_id: 'O1', fire_ms: 5 * MIN, deadline_ms: 9 * MIN, mark: null, frozen: true, ...over });
const body = (now: NowLine[], details: LineDetail[] = []): KdsStationBody => ({
  station_id: ST,
  day_open: true,
  sound_volume: 70,
  has_printer: false,
  lanes: { lanes_on: 1, lane_count: 1 },
  now,
  details,
});
const catchUp = (b: KdsStationBody, lines: PlanLine[] = []): WsServerMessage => ({
  type: 'catch_up',
  as_of_seq: 1,
  state: { kds_station: b, station_plan: [{ station_id: ST, as_of_seq: 1, lines }] },
});
const planFrame = (lines: PlanLine[]): WsServerMessage => ({ type: 'station_plan', station_id: ST, as_of_seq: 2, lines });
let seq = 10;
const ev = (event_type: string, payload: Record<string, unknown>): WsServerMessage => {
  seq += 1;
  return { type: 'event', seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } };
};

type Calls = Array<[string, unknown]>;
function fakeApi(calls: Calls): KdsApi {
  const next = (name: keyof KdsApi) => async (p: unknown) => {
    calls.push([name, p]);
    return { ok: true, data: { started: ['x'], done: ['x'], undone: ['x'], ready_undone: [] } } as never;
  };
  return { startItem: next('startItem'), doneItem: next('doneItem'), undoDone: next('undoDone'), giveMeMore: next('giveMeMore'), setLaneState: next('setLaneState') };
}
function Harness({ api, v }: { api: KdsApi; v: KdsView }) {
  const actions = useKdsActions(api, fakeTimers(), () => {});
  return (
    <StationView
      view={v}
      nowMs={2 * MIN}
      utcOffsetMs={0}
      up
      batch
      actionsFor={(r) => <RowActions row={r} mode="two_tap" nowMs={2 * MIN} up state={actions.stateOf(r.order_item_id)} onTap={(a, c) => void actions.tap(r, a, c)} />}
    />
  );
}

let m: Mounted;
afterEach(() => m?.unmount());
const store = () => createKdsStore({ stationId: ST, now: () => 2 * MIN });
const nowCards = () => [...m.container.querySelectorAll<HTMLElement>('.kcards .kl')];
const nextRows = () => [...m.container.querySelectorAll<HTMLElement>('.knx .knr')];
const itemText = (el: Element) => el.querySelector('.kl__it, .knr__it')?.textContent;
const roundOf = (el: Element) => el.querySelector('[data-round]')?.textContent ?? null;
const chipOf = (el: Element) => el.querySelector('.kmk--prio')?.textContent ?? null;

const N = ['N', 'N-p2', 'N-p3', 'N-p4', 'N-p5', 'N-p6', 'N-p7', 'N-p8', 'N-p9', 'N-p10'];

describe('[03b v1.0.14 §3.3, #93] KDS rows per batch round (STAB-6)', () => {
  it('[#93] naan ×10: L1 (fired, 3 parts) → "3 x Naan · this round" in Now, L2 (frozen, 7 parts) → "7 x Naan · next round" in Next; Start sends L1 only', async () => {
    const s = store();
    const parts = (ids: string[]) => ids.map((id) => detail(id, { part_of: 'N' }));
    s.apply(
      catchUp(
        body(
          N.slice(0, 3).map((id) => nowLine(id, { load_id: 'ST:L1' }, { part_of: 'N' })),
          parts(N.slice(3)),
        ),
        N.slice(3).map((id) => planLine(id, { load_id: 'ST:L2' })),
      ),
    );
    const calls: Calls = [];
    m = mount();
    m.render(<Harness api={fakeApi(calls)} v={s.snapshot()} />);
    expect(nowCards().map((c) => [itemText(c), roundOf(c)])).toEqual([['3 xNaan', t('kds.round.this')]]);
    expect(nextRows().map((r) => [itemText(r), roundOf(r)])).toEqual([['7 xNaan', t('kds.round.next')]]);
    m.click(m.button('Start', nowCards()[0]));
    await flush();
    expect(calls.map(([, p]) => (p as { order_item_id: string }).order_item_id)).toEqual(['N', 'N-p2', 'N-p3']);
  });

  it('[#93; m-8] the round is station-wide: a third load of another order reads "round 3"; L1 reads "this round" whatever its order', () => {
    const s = store();
    s.apply(
      catchUp(body([nowLine('A', { load_id: 'ST:L1' }, { order_id: 'O9', part_of: 'A' })], [detail('B', { part_of: 'B' }), detail('C', { order_id: 'O7' })]), [
        planLine('B', { load_id: 'ST:L2', fire_ms: 4 * MIN }),
        planLine('C', { order_id: 'O7', load_id: 'ST:L3', fire_ms: 6 * MIN }),
      ]),
    );
    m = mount();
    m.render(<Harness api={fakeApi([])} v={s.snapshot()} />);
    expect(roundOf(nowCards()[0]!)).toBe(t('kds.round.this'));
    expect(nextRows().map(roundOf)).toEqual([t('kds.round.next'), fill(t('kds.round.n'), { n: '3' })]);
  });

  it('[#93] a fired load keeps its load_id from FireDispatched; at a slot station (no load_id) parts in one stage stay one row with no tag (v1.0.11 #86)', () => {
    const s = store();
    s.apply(catchUp(body([], [detail('N', { part_of: 'N' }), detail('N-p2', { part_of: 'N' })]), [planLine('N'), planLine('N-p2')]));
    s.apply(ev('FireDispatched', { station_id: ST, order_item_ids: ['N', 'N-p2'], load_id: null, due_at: 0, reason: 'scheduled' }));
    m = mount();
    m.render(<Harness api={fakeApi([])} v={s.snapshot()} />);
    expect(nowCards().map((c) => [itemText(c), roundOf(c)])).toEqual([['2 xNaan', null]]);
    const b = store();
    b.apply(catchUp(body([], [detail('X')]), [planLine('X', { load_id: 'ST:X' })]));
    b.apply(ev('FireDispatched', { station_id: ST, order_item_ids: ['X'], load_id: 'ST:X', due_at: 0, reason: 'scheduled' }));
    expect(b.snapshot().rows[0]!.load_id).toBe('ST:X');
  });
});

describe('[03b v1.0.14 §3.3, #94, #95] KDS priority chip (STAB-7)', () => {
  const prio = (minutes_late: number) => ({ since_ms: MIN, minutes_late });

  it('[#94] a station_plan line with minutes_late 6 → "Priority · 6 min late"; 0 → "Priority" alone; a grouped row with one priority part shows the chip', () => {
    const s = store();
    s.apply(
      catchUp(body([], [detail('A'), detail('B'), detail('G', { part_of: 'G' }), detail('G-p2', { part_of: 'G' })]), [
        planLine('A', { priority: prio(6) }),
        planLine('B', { priority: prio(0) }),
        planLine('G', { fire_ms: 6 * MIN }),
        planLine('G-p2', { fire_ms: 6 * MIN, priority: prio(2) }),
      ]),
    );
    m = mount();
    m.render(<Harness api={fakeApi([])} v={s.snapshot()} />);
    expect(nextRows().map(chipOf)).toEqual([fill(t('kds.priority'), { n: '6' }), t('kds.priority_short'), fill(t('kds.priority'), { n: '2' })]);
  });

  it('[#94] Now: the chip from the catch-up; after Start the chip goes; a boosted line keeps its red mark and stands above it', () => {
    const s = store();
    s.apply(catchUp(body([nowLine('P', { priority: prio(4) }), nowLine('X', { mark: 'boost' })])));
    m = mount();
    m.render(<Harness api={fakeApi([])} v={s.snapshot()} />);
    expect(nowCards().map((c) => c.getAttribute('data-id'))).toEqual(['X', 'P']);
    expect(chipOf(nowCards()[1]!)).toBe(fill(t('kds.priority'), { n: '4' }));
    expect(nowCards()[0]!.querySelector('.kmk.c-danger')).not.toBeNull();
    s.apply(ev('ItemStarted', { order_item_id: 'P', started_at: 2 * MIN, source: 'tap' }));
    m.render(<Harness api={fakeApi([])} v={s.snapshot()} />);
    expect(chipOf(nowCards()[1]!)).toBeNull();
  });

  it('[#94; m-5] a priority line entering Next while two older rows are shown is appended below them, even with an earlier fire_ms; the older rows keep their places', () => {
    const s = store();
    s.apply(catchUp(body([], [detail('A'), detail('B'), detail('P')]), [planLine('A', { fire_ms: 5 * MIN }), planLine('B', { fire_ms: 6 * MIN }), planLine('P', { frozen: false, fire_ms: 9 * MIN })]));
    s.apply(planFrame([planLine('P', { fire_ms: 4 * MIN, priority: prio(6) }), planLine('A', { fire_ms: 5 * MIN }), planLine('B', { fire_ms: 6 * MIN })]));
    m = mount();
    m.render(<Harness api={fakeApi([])} v={s.snapshot()} />);
    expect(nextRows().map((r) => r.getAttribute('data-id'))).toEqual(['A', 'B', 'P']);
    expect(chipOf(nextRows()[2]!)).toBe(fill(t('kds.priority'), { n: '6' }));
  });

  it('[#95; m-6] a LinePrioritized frame sets "Priority" with no minutes whatever its delay_ms; the next station_plan makes it "Priority · 6 min late"; an id not held is ignored', () => {
    const s = store();
    s.apply(catchUp(body([nowLine('F')], [detail('A')]), [planLine('A')]));
    s.apply(ev('LinePrioritized', { order_id: 'O1', group_id: 'O1:0', order_item_ids: ['A', 'F', 'NOPE'], delay_ms: 7 * MIN, at_ms: 2 * MIN }));
    m = mount();
    m.render(<Harness api={fakeApi([])} v={s.snapshot()} />);
    expect(nextRows().map(chipOf)).toEqual([t('kds.priority_short')]);
    expect(chipOf(nowCards()[0]!)).toBe(t('kds.priority_short'));
    expect(s.snapshot().rows.map((r) => r.order_item_id)).toEqual(['F']);
    s.apply(planFrame([planLine('A', { priority: prio(6) })]));
    m.render(<Harness api={fakeApi([])} v={s.snapshot()} />);
    expect(nextRows().map(chipOf)).toEqual([fill(t('kds.priority'), { n: '6' })]);
  });
});
