import type { LineDetail } from '@pos/domain';
import type { KdsStationBody, WsServerMessage } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import type { HubResult } from '../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../test/dom';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import type { PointLine, PointStation, PointViewBody } from './contracts';
import { passLiveOf } from './live';
import { PassScreen } from './PassScreen';

// 03b v1.0.11 §3.4, §3.6, #88, #89 (STAB-5 phase 3; proposal §3.5, owner Q1 = b): a split line's parts (`part_of`,
// 02b v1.0.20 §3.2 step 4a) on the Pass — one card row per part_of + stage + hand-over state; its Start / Done / Undo
// act on all its parts; the Ready pick sheet's count stepper; the hand-over sheet and takeover sections group too.

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id: 'TANDOOR',
    point_id: 'PT',
    identifier: { kind: 'table', label: 'T3' },
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
    cook_ms: 1,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    ...over,
  };
}
const line = (id: string, stage: PointLine['stage'], over: Partial<LineDetail> = {}, handed_over = false): PointLine => ({ ...detail(id, { part_of: 'N', ...over }), stage, handed_over });
const karahi = (id: string, stage: PointLine['stage']) => line(id, stage, { part_of: 'K', item_name: 'Karahi', station_id: 'KARAHI' });
const st = (station_id: string): PointStation => ({ station_id, name: station_id, lanes: { lanes_on: 1, lane_count: 1 }, dark: false });
const order = (lines: PointLine[]): PointViewBody => ({
  point_id: 'PT',
  stations: [st('TANDOOR'), st('KARAHI')],
  takeovers: [],
  orders: [{ order_id: 'O1', identifier: { kind: 'table', label: 'T3' }, placed_at: 0, ready: null, lines }],
});

function shellWith(answers: Record<string, Array<HubResult<unknown>>>) {
  const live = createLiveBus();
  const sent: Array<{ type: string; payload: unknown }> = [];
  const shell = {
    live,
    clock: { nowMs: () => 1_000_000, utcOffsetMs: 0 },
    api: {
      roster: () => new Promise(() => undefined),
      command: (type: string, payload: unknown) => {
        sent.push({ type, payload });
        const list = answers[type] ?? [];
        return Promise.resolve((list.length > 1 ? list.shift() : list[0]) ?? { ok: false, error: { kind: 'network' } });
      },
      query: () => Promise.resolve({ ok: true, data: { receivers: [] } }),
    },
    permissions: { allowed: (p: string) => p === 'run-pass' },
    toasts: { show: () => undefined },
    online: true,
    portrait: false,
    me: { staff_id: 'S1', name: 'Asif' },
  } as unknown as Shell;
  const pass = passLiveOf(shell);
  const raw = (f: WsServerMessage) => {
    live.frame(f);
    pass.frame(f);
  };
  return { shell, sent, raw };
}

let m: Mounted;
afterEach(() => m?.unmount());
function show(shell: Shell) {
  m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <PassScreen />
    </ShellContext.Provider>,
  );
}
const ok = (data: unknown): HubResult<unknown> => ({ ok: true, data });
const rows = () => [...m.container.querySelectorAll('.pc .pl')].map((r) => [r.getAttribute('data-id'), r.querySelector('.pl__t')?.textContent, r.querySelector('.stg')?.textContent]);
const row = (id: string) => m.container.querySelector(`.pc .pl[data-id="${id}"]`)!;
const ids = (sent: Array<{ type: string; payload: unknown }>, type: string) => sent.filter((c) => c.type === type).map((c) => (c.payload as { order_item_id: string }).order_item_id);
const dialog = () => m.container.querySelector('[role="dialog"]')!;

describe('[03b v1.0.11 §3.4] Pass split-line parts (STAB-5)', () => {
  it('[03b #88] one row "3 x Naan" for three parts in one stage; two rows for two stages; Start / Done per part', async () => {
    const s = shellWith({ StartItem: [ok({ started: ['x'] })], DoneItem: [ok({ done: ['x'] })] });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: order([line('N', 'added', { options: ['Raita'] }), line('N-p2', 'added', { options: ['Raita'] }), line('N-p3', 'added', { options: ['Raita'] })]) } });
    show(s.shell);
    expect(rows()).toEqual([['N', '3 xNaan', 'waiting']]);
    expect(row('N').querySelector('.pl__o')?.textContent).toBe('3 x Raita');
    m.click(m.button('Start', row('N')));
    await flush();
    expect(ids(s.sent, 'StartItem')).toEqual(['N', 'N-p2', 'N-p3']);

    s.raw({ type: 'catch_up', as_of_seq: 2, state: { point_view: order([line('N', 'done'), line('N-p2', 'cooking'), line('N-p3', 'cooking')]) } });
    await flush();
    expect(rows()).toEqual([
      ['N', '1 xNaan', 'done'],
      ['N-p2', '2 xNaan', 'cooking'],
    ]);
    m.click(m.button('Done', row('N-p2')));
    await flush();
    expect(ids(s.sent, 'DoneItem').sort()).toEqual(['N-p2', 'N-p3']);

    // the frames move both parts to done: one row again; Undo undoes only this tablet's Done parts
    s.raw({ type: 'event', seq: 3, event: { event_id: 'E3', event_type: 'ItemDone', schema_version: 1, payload: { order_item_id: 'N-p2', done_at: 1_000_000 } } });
    s.raw({ type: 'event', seq: 4, event: { event_id: 'E4', event_type: 'ItemDone', schema_version: 1, payload: { order_item_id: 'N-p3', done_at: 1_000_000 } } });
    await flush();
    expect(rows()).toEqual([['N', '3 xNaan', 'done']]);
    s.sent.length = 0;
    m.click(m.button('Undo', row('N')));
    await flush();
    expect(ids(s.sent, 'UndoDone').sort()).toEqual(['N-p2', 'N-p3']);
  });

  it('[03b v1.0.12 #90] a grouped Done sends the part that started last first, by started_at; an ItemStarted frame sets it (STAB-5 Q5)', async () => {
    const s = shellWith({ DoneItem: [ok({ done: ['x'] })] });
    const started = (id: string, started_at: number) => ({ ...line(id, 'cooking'), started_at });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: order([started('N', 0), started('N-p2', 100_000), started('N-p3', 50_000)]) } });
    show(s.shell);
    m.click(m.button('Done', row('N')));
    await flush();
    expect(ids(s.sent, 'DoneItem')).toEqual(['N-p2', 'N-p3', 'N']);

    // a waiting part that starts live takes the frame's started_at
    const t = shellWith({ DoneItem: [ok({ done: ['x'] })] });
    m.unmount();
    t.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: order([started('M', 500_000), { ...line('M-p2', 'added'), started_at: null }]) } });
    t.raw({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'ItemStarted', schema_version: 1, payload: { order_item_id: 'M-p2', started_at: 900_000 } } });
    show(t.shell);
    m.click(m.button('Done', row('M')));
    await flush();
    expect(ids(t.sent, 'DoneItem')).toEqual(['M-p2', 'M']);
  });

  it('[03b #88] a grouped Done that needs a confirm asks once; the confirm sends every part with confirm: true', async () => {
    const s = shellWith({ DoneItem: [{ ok: false, error: { kind: 'api', status: 422, code: 'ITEM_DONE_CONFIRM_REQUIRED', details: { elapsed_ms: 1_000, cook_ms: 60_000 } } }, ok({ done: ['x'] })] });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: order([line('N', 'cooking'), line('N-p2', 'cooking')]) } });
    show(s.shell);
    m.click(m.button('Done', row('N')));
    await flush();
    expect(s.sent.filter((c) => c.type === 'DoneItem')).toHaveLength(1);
    expect(m.container.querySelector('.pc__msg.c-warn')?.textContent).toContain('Done already?');
    m.click(m.button('Done', row('N')));
    await flush();
    expect(s.sent.slice(1).map((c) => c.payload)).toEqual(
      expect.arrayContaining([
        { order_item_id: 'N', confirm: true },
        { order_item_id: 'N-p2', confirm: true },
      ]),
    );
    expect(s.sent).toHaveLength(3);
  });

  it('[03b #88] the Ready pick sheet: a stepper per grouped row ("3 of 3" done, "0 of 2" cooking); one cooking part warns; confirm sends the ids', async () => {
    const s = shellWith({ MarkReadyToServe: [ok({ alert_id: 'A1' })] });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: order([line('N', 'done'), line('N-p2', 'done'), line('N-p3', 'done'), karahi('K', 'cooking'), karahi('K-p2', 'cooking')]) } });
    show(s.shell);
    m.click(m.button('Ready to serve'));
    await flush();
    const counts = () => [...dialog().querySelectorAll('.rdpick__row')].map((r) => [r.querySelector('.rdpick__t')?.textContent, r.querySelector('output')?.textContent]);
    expect(counts()).toEqual([
      ['3 xNaan', '3 of 3'],
      ['2 xKarahi', '0 of 2'],
    ]);
    expect(dialog().querySelector('.msg.c-warn')).toBeNull();
    const more = dialog().querySelectorAll<HTMLButtonElement>('.rdpick__row')[1]!.querySelector<HTMLButtonElement>('button[aria-label="One more"]')!;
    m.click(more);
    await flush();
    expect(counts()[1]).toEqual(['2 xKarahi', '1 of 2']);
    expect(dialog().querySelector('.msg.c-warn')?.textContent).toContain('Karahi');
    m.click(m.button('Ready to serve (4)', dialog()));
    await flush();
    expect(s.sent).toEqual([expect.objectContaining({ type: 'MarkReadyToServe', payload: { order_id: 'O1', point_id: 'PT', order_item_ids: ['N', 'N-p2', 'N-p3', 'K'] } })]);
  });

  it('[03b #88] the hand-over sheet lists the done parts grouped: "3 x Naan"', async () => {
    const s = shellWith({});
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: order([line('N', 'done'), line('N-p2', 'done'), line('N-p3', 'done')]) } });
    show(s.shell);
    m.click(m.button('Hand over'));
    await flush();
    expect([...dialog().querySelectorAll('.hosum > span')].map((e) => e.textContent)).toEqual(['3 xNaan']);
  });

  it('[03b #89] a takeover section groups its Now rows as the KDS; its grouped Start sends one command per part', async () => {
    const s = shellWith({ StartItem: [ok({ started: ['x'] })] });
    const now = (id: string): KdsStationBody['now'][number] => ({ ...detail(id, { part_of: 'N' }), stage: 'added', fired_at: 1_000, started_at: null, mark: null, done_undone: false });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: { ...order([]), orders: [] } } });
    show(s.shell);
    s.raw({
      type: 'station_takeover',
      station_id: 'TANDOOR',
      active: true,
      view: { station_id: 'TANDOOR', day_open: true, sound_volume: 70, has_printer: false, lanes: { lanes_on: 1, lane_count: 1 }, now: [now('N'), now('N-p2')], details: [] },
    });
    await flush();
    const sec = m.container.querySelector('section.tko')!;
    expect([...sec.querySelectorAll('.kcards article.kl')].map((a) => [a.getAttribute('data-id'), a.querySelector('.kl__it')?.textContent])).toEqual([['N', '2 xNaan']]);
    m.click(m.button('Start', sec.querySelector('article[data-id="N"]')!));
    await flush();
    expect(ids(s.sent, 'StartItem')).toEqual(['N', 'N-p2']);
  });
});
