import type { LineDetail } from '@pos/domain';
import type { StationPlanBody } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import type { HubResult } from '../../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { fakeTimers } from '../../alerts/test-fakes';
import type { KdsApi } from '../contracts';
import { StationView } from '../station/StationView';
import type { KdsRow, KdsView } from '../store';
import { useKdsActions, type CompletionMode } from './actions';
import { RowActions } from './DoneEarly';
import { InlineError } from './InlineError';

// 03b v1.0.11 §3.3, #86, #87 (STAB-5 phase 3; proposal §3.5, owner Q1 = b): a split line's parts (`part_of`, 02b
// v1.0.20 §3.2 step 4a) in one stage are one KDS row; Start / Done / Undo on it send one command per part.

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id: 'ST',
    point_id: 'P1',
    identifier: { kind: 'table', label: 'T-4' },
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
    cook_ms: 360_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    ...over,
  };
}
const part = (id: string, o: Partial<KdsRow> = {}, d: Partial<LineDetail> = {}): KdsRow => ({
  order_item_id: id,
  order_id: 'O1',
  stage: 'added',
  fired_at: 0,
  started_at: null,
  mark: null,
  done_undone: false,
  done_at: null,
  detail: detail(id, { part_of: 'N', options: ['Raita'], ...d }),
  ...o,
});
const view = (rows: KdsRow[], plan: StationPlanBody | null = null, details = new Map<string, LineDetail>()): KdsView => ({
  station: { station_id: 'ST', day_open: true, sound_volume: 70, has_printer: false, lanes: { lanes_on: 1, lane_count: 1 }, now: [], details: [] },
  details,
  arrived_at: new Map(),
  rows,
  plan,
  archived: null,
});

type Calls = Array<[string, unknown]>;
function fakeApi(replies: Partial<Record<keyof KdsApi, Array<HubResult<unknown>>>>, calls: Calls): KdsApi {
  const next = (name: keyof KdsApi) => async (p: unknown) => {
    calls.push([name, p]);
    const list = replies[name] ?? [];
    return (list.length > 1 ? list.shift() : list[0]) as never;
  };
  return { startItem: next('startItem'), doneItem: next('doneItem'), undoDone: next('undoDone'), giveMeMore: next('giveMeMore'), setLaneState: next('setLaneState') };
}
const apiErr = (code: string, details: Record<string, unknown> = {}, status = 409): HubResult<never> => ({ ok: false, error: { kind: 'api', status, code, details } });

function Harness({ api, v, nowMs, mode = 'two_tap' }: { api: KdsApi; v: KdsView; nowMs: number; mode?: CompletionMode }) {
  const actions = useKdsActions(api, fakeTimers(), () => {});
  return (
    <StationView
      view={v}
      nowMs={nowMs}
      utcOffsetMs={0}
      up
      actionsFor={(r) => <RowActions row={r} mode={mode} nowMs={nowMs} up state={actions.stateOf(r.order_item_id)} onTap={(a, c) => void actions.tap(r, a, c)} />}
      messageFor={(r) => <InlineError msg={actions.stateOf(r.order_item_id).msg} />}
    />
  );
}

let m: Mounted;
afterEach(() => m?.unmount());
const cards = () => [...m.container.querySelectorAll<HTMLElement>('.kcards .kl')];
const itemText = (el: Element) => el.querySelector('.kl__it')?.textContent;
const card = (id: string) => m.container.querySelector(`.kcards [data-id="${id}"]`)!;

describe('[03b v1.0.11 §3.3] KDS split-line parts (STAB-5)', () => {
  it('[03b #86] parts of one part_of in one stage → one row "3 x Naan" (options summed); another stage → its own row', () => {
    m = mount();
    m.render(<Harness api={fakeApi({}, [])} v={view([part('N'), part('N-p2'), part('N-p3')])} nowMs={1_000} />);
    expect(cards()).toHaveLength(1);
    expect(itemText(cards()[0]!)).toBe('3 xNaan');
    expect([...cards()[0]!.querySelectorAll('.kl__opts li')].map((li) => li.textContent)).toEqual(['3 x Raita']);

    m.render(<Harness api={fakeApi({}, [])} v={view([part('N'), part('N-p2', { stage: 'cooking', started_at: 500 }), part('N-p3')])} nowMs={1_000} />);
    // append order: the waiting row stands at its first part's place (N), the cooking one at N-p2's
    expect(cards().map((c) => [c.getAttribute('data-id'), itemText(c)])).toEqual([
      ['N', '2 xNaan'],
      ['N-p2', '1 xNaan'],
    ]);
  });

  it('[03b #86] lines without part_of, or with another part_of, are not grouped', () => {
    m = mount();
    const plain = (id: string): KdsRow => ({ ...part(id), detail: detail(id) });
    m.render(<Harness api={fakeApi({}, [])} v={view([plain('A'), plain('B'), part('N'), part('M', {}, { part_of: 'M' })])} nowMs={1_000} />);
    expect(cards().map((c) => itemText(c))).toEqual(['1 xNaan', '1 xNaan', '1 xNaan', '1 xNaan']);
  });

  it('[03b #86] Start / Done / Undo on a grouped row send one command per part', async () => {
    const calls: Calls = [];
    const api = fakeApi(
      {
        startItem: [{ ok: true, data: { started: ['x'] } }],
        doneItem: [{ ok: true, data: { done: ['x'] } }],
        undoDone: [{ ok: true, data: { undone: ['x'], ready_undone: [] } }],
      },
      calls,
    );
    m = mount();
    m.render(<Harness api={api} v={view([part('N', { stage: 'cooking', started_at: 0 }), part('N-p2'), part('N-p3')])} nowMs={1_000} />);
    m.click(m.button('Start', card('N-p2')));
    await flush();
    expect(calls).toEqual([
      ['startItem', { order_item_id: 'N-p2' }],
      ['startItem', { order_item_id: 'N-p3' }],
    ]);
    calls.length = 0;
    m.render(<Harness api={api} v={view([part('N', { stage: 'cooking', started_at: 0 }), part('N-p2', { stage: 'cooking', started_at: 10 }), part('N-p3', { stage: 'cooking', started_at: 5 })])} nowMs={400_000} />);
    expect(cards()).toHaveLength(1);
    m.click(m.button('Done', card('N')));
    await flush();
    // the part that started last goes first
    expect(calls.map(([, p]) => (p as { order_item_id: string }).order_item_id)).toEqual(['N-p2', 'N-p3', 'N']);
    expect(calls.every(([name]) => name === 'doneItem')).toBe(true);
    calls.length = 0;
    const done = (id: string) => part(id, { stage: 'done', started_at: 0, done_at: 400_000 });
    m.render(<Harness api={api} v={view([done('N'), done('N-p2'), done('N-p3')])} nowMs={405_000} />);
    m.click(m.button('Undo', card('N')));
    await flush();
    expect(calls).toEqual([
      ['undoDone', { order_item_id: 'N' }],
      ['undoDone', { order_item_id: 'N-p2' }],
      ['undoDone', { order_item_id: 'N-p3' }],
    ]);
  });

  it('[03b #87] the last-started part under 50 % → one DoneItem, "Done already?" once; the confirm sends every part with confirm', async () => {
    const calls: Calls = [];
    const api = fakeApi({ doneItem: [apiErr('ITEM_DONE_CONFIRM_REQUIRED', { elapsed_ms: 60_000, cook_ms: 360_000 }, 422), { ok: true, data: { done: ['x'] } }] }, calls);
    m = mount();
    m.render(<Harness api={api} v={view([part('N', { stage: 'cooking', started_at: 0 }), part('N-p2', { stage: 'cooking', started_at: 100_000 })])} nowMs={160_000} />);
    m.click(m.button('Done', card('N')));
    await flush();
    expect(calls).toEqual([['doneItem', { order_item_id: 'N-p2' }]]);
    const confirms = m.container.querySelectorAll('.btn--confirm');
    expect(confirms).toHaveLength(1);
    m.click(confirms[0]);
    await flush();
    expect(calls.slice(1)).toEqual([
      ['doneItem', { order_item_id: 'N-p2', confirm: true }],
      ['doneItem', { order_item_id: 'N', confirm: true }],
    ]);
  });

  it('[03b #86] Next groups planned parts with the same fire_ms only', () => {
    const plan: StationPlanBody = {
      station_id: 'ST',
      as_of_seq: 1,
      lines: [
        { order_item_id: 'N', order_id: 'O1', fire_ms: 60_000, deadline_ms: 0, frozen: true, mark: null },
        { order_item_id: 'N-p2', order_id: 'O1', fire_ms: 60_000, deadline_ms: 0, frozen: true, mark: null },
        { order_item_id: 'N-p3', order_id: 'O1', fire_ms: 120_000, deadline_ms: 0, frozen: true, mark: null },
      ],
    };
    const details = new Map(['N', 'N-p2', 'N-p3'].map((id) => [id, detail(id, { part_of: 'N' })]));
    m = mount();
    m.render(<Harness api={fakeApi({}, [])} v={view([], plan, details)} nowMs={0} />);
    const rows = [...m.container.querySelectorAll('.knx .knr')].map((r) => r.querySelector('.knr__it')?.textContent);
    expect(rows).toEqual(['2 xNaan', '1 xNaan']);
  });
});
