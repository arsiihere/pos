import type { LineDetail } from '@pos/domain';
import type { KdsStationBody, WsServerMessage } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { setLanguage } from '../../i18n';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import { LineRow } from './cards/LineRow';
import type { PointLine, PointOrder, PointViewBody } from './contracts';
import { passLiveOf } from './live';
import { PassScreen } from './PassScreen';
import { createPassStore } from './store';

// 02b-TK L-CLIENT-2 item 1 (03b v1.0.16 §3.10 "Pass archive (D7)", §6.15, §6.16 (R3-M-1); D7): after a config apply
// that archives a Pass point, the hub sends `point_view_refresh { as_of_seq, view }` to the Pass sockets of the
// moved-from and moved-to points. The refresh replaces the cards as a catch-up's point_view does, resets the held
// ids and supersedes frames through as_of_seq; `view: null` = this tablet's point was retired (no cards, no actions).
// A moved line carries LineDetail.moved_from (the old point's name) and shows "Moved from {point}" on its row.

const PT = 'PT-MAIN';

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id, order_id: 'O1', station_id: 'ST-T', point_id: PT, identifier: { kind: 'token', token: 46, date: null }, order_type: 'takeaway', item_name: 'Naan', units: 2,
    line_kind: 'item', for_parent: null, deal_name: null, options: [], kitchen_note: null, order_note: null, return_of: null, cook_ms: 120_000, prep_ms: 0, from_stock: false,
    placed_by_name: null, ...over,
  };
}
const line = (id: string, over: Partial<PointLine> = {}): PointLine => ({ ...detail(id), stage: 'added', handed_over: false, ...over });
const order = (order_id: string, lines: PointLine[], over: Partial<PointOrder> = {}): PointOrder => ({ order_id, identifier: { kind: 'token', token: Number(order_id.replace(/\D/g, '')) || 46, date: null }, placed_at: 1_000, lines, ready: null, ...over });
const takeoverBody = (station_id: string): KdsStationBody => ({ station_id, day_open: true, sound_volume: 70, has_printer: false, lanes: { lanes_on: 1, lane_count: 1 }, now: [], details: [] });
const view = (over: Partial<PointViewBody> = {}): PointViewBody => ({ point_id: PT, stations: [{ station_id: 'ST-T', name: 'Tandoor', lanes: { lanes_on: 1, lane_count: 1 }, dark: false }], orders: [], takeovers: [], ...over });
const catchUp = (v: PointViewBody): WsServerMessage => ({ type: 'catch_up', as_of_seq: 1, state: { point_view: v } });
const refresh = (as_of_seq: number, v: PointViewBody | null): WsServerMessage => ({ type: 'point_view_refresh', as_of_seq, view: v as unknown as Record<string, unknown> | null });
const ev = (seq: number, event_type: string, payload: Record<string, unknown>): WsServerMessage => ({ type: 'event', seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } });

describe('[03b v1.0.16 §6.16 (R3-M-1), D7] the Pass store on point_view_refresh', () => {
  it('replaces the cards, stations and takeovers with the frame\'s view, as a catch-up does; listeners are told', () => {
    const store = createPassStore({ now: () => 5_000 });
    let calls = 0;
    store.subscribe(() => (calls += 1));
    store.apply(catchUp(view({ orders: [order('O1', [line('A')]), order('O2', [line('B', { order_id: 'O2' })])] })));
    const moved = order('O9', [line('M1', { order_id: 'O9', moved_from: 'Takeaway Pass' })], { placed_at: 900 });
    store.apply(refresh(40, view({ orders: [order('O1', [line('A', { stage: 'cooking' })]), moved], takeovers: [takeoverBody('ST-DARK')] })));
    const v = store.snapshot().view!;
    expect(v.orders.map((o) => o.order_id)).toEqual(['O1', 'O9']);
    expect(v.orders[0]!.lines[0]!.stage).toBe('cooking');
    expect(v.orders[1]!.lines[0]!.moved_from).toBe('Takeaway Pass');
    expect([...store.snapshot().takeovers.keys()]).toEqual(['ST-DARK']);
    expect(store.snapshot().retired).toBe(false);
    expect(calls).toBe(2);
    // the held-ID map is reset: the dropped card's line is no longer held, the moved one is
    expect(store.hold(['A', 'B', 'M1'])).toEqual(['A', 'M1']);
  });

  it('supersedes frames through as_of_seq: an event of the refreshed commit changes nothing, a newer one applies', () => {
    const store = createPassStore({ now: () => 5_000 });
    store.apply(catchUp(view({ orders: [order('O1', [line('A')])] })));
    store.apply(refresh(40, view({ orders: [order('O1', [line('A')])] })));
    const before = store.snapshot();
    store.apply(ev(40, 'ItemStarted', { order_item_id: 'A', started_at: 4_000 }));
    expect(store.snapshot()).toBe(before);
    store.apply(ev(41, 'ItemStarted', { order_item_id: 'A', started_at: 4_100 }));
    expect(store.snapshot().view!.orders[0]!.lines[0]!.stage).toBe('cooking');
  });

  it('view null: this point was retired — no view, no cards, retired set; frames change nothing; the next catch-up clears it', () => {
    const store = createPassStore({ now: () => 5_000 });
    store.apply(catchUp(view({ orders: [order('O1', [line('A')])], takeovers: [takeoverBody('ST-DARK')] })));
    store.apply(refresh(40, null));
    expect(store.snapshot()).toMatchObject({ view: null, retired: true });
    expect(store.snapshot().takeovers.size).toBe(0);
    expect(store.hold(['A'])).toEqual([]);
    const before = store.snapshot();
    store.apply(ev(41, 'ItemStarted', { order_item_id: 'A' }));
    store.apply({ type: 'point_lines', point_id: PT, lines: [detail('A')] } as WsServerMessage);
    expect(store.snapshot()).toBe(before);
    store.apply(catchUp(view({ orders: [order('O1', [line('A')])] })));
    expect(store.snapshot().retired).toBe(false);
    expect(store.snapshot().view!.orders).toHaveLength(1);
  });

  it('a refresh with a malformed view is ignored', () => {
    const store = createPassStore({ now: () => 5_000 });
    store.apply(catchUp(view({ orders: [order('O1', [line('A')])] })));
    const before = store.snapshot();
    store.apply({ type: 'point_view_refresh', as_of_seq: 40, view: { point_id: 7 } } as WsServerMessage);
    expect(store.snapshot()).toBe(before);
  });
});

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  setLanguage('en');
});

describe('[03b v1.0.16 §3.10, §6.15 (R3-M-1)] "Moved from {point}" on a moved Pass line', () => {
  it('a line with moved_from shows the label on its row; a line without it shows none', async () => {
    m = mount();
    m.render(
      <>
        <LineRow line={line('M1', { moved_from: 'Takeaway Pass' })} />
        <LineRow line={line('A')} />
      </>,
    );
    await flush();
    const rows = m.container.querySelectorAll('.pl');
    expect(rows[0]!.querySelector('[data-moved]')!.textContent).toBe('Moved from Takeaway Pass');
    expect(rows[1]!.querySelector('[data-moved]')).toBeNull();
  });

  it('Urdu: the label is translated; the point name stays as given', async () => {
    setLanguage('ur');
    m = mount();
    m.render(<LineRow line={line('M1', { moved_from: 'Takeaway Pass' })} />);
    await flush();
    const label = m.container.querySelector('[data-moved]')!.textContent!;
    expect(label).toContain('Takeaway Pass');
    expect(label).not.toContain('Moved from');
  });
});

function shellFor(): Shell {
  return {
    live: createLiveBus(),
    clock: { nowMs: () => 5_000, utcOffsetMs: 5 * 3_600_000 },
    api: { roster: () => new Promise(() => undefined), command: () => Promise.resolve({ ok: true, data: {} }), query: () => Promise.resolve({ ok: true, data: { orders: [] } }) },
    permissions: { allowed: (p: string) => p === 'run-pass' },
    toasts: { show: () => undefined },
    online: true,
    portrait: false,
    me: { staff_id: 'S1', name: 'Cook' },
    device: { token: 'DEV', id: 'D-P1', type: 'tablet' },
  } as unknown as Shell;
}

describe('[03b v1.0.16 §6.16 (R3-M-1)] the Pass screen on a refresh', () => {
  it('the receiving Pass: the refreshed cards, the moved line labelled; the retired Pass: one full-screen state, no cards, no actions', async () => {
    const shell = shellFor();
    const pass = passLiveOf(shell);
    const raw = (f: WsServerMessage) => {
      shell.live.frame(f);
      pass.frame(f);
    };
    raw(catchUp(view({ orders: [order('O1', [line('A', { stage: 'done' })])] })));
    m = mount();
    m.render(
      <ShellContext.Provider value={shell}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    await flush();
    expect(m.container.querySelectorAll('.pc')).toHaveLength(1);
    raw(refresh(40, view({ orders: [order('O1', [line('A', { stage: 'done' })]), order('O9', [line('M1', { order_id: 'O9', moved_from: 'Takeaway Pass' })], { placed_at: 2_000 })] })));
    await flush();
    expect(m.container.querySelectorAll('.pc')).toHaveLength(2);
    expect(m.container.querySelector('.pc[data-order="O9"] [data-moved]')!.textContent).toBe('Moved from Takeaway Pass');

    raw(refresh(41, null));
    await flush();
    const state = m.container.querySelector('[data-retired]')!;
    expect(state.textContent).toContain('This point was retired — ask a manager to set this tablet to another point');
    expect(m.container.querySelectorAll('.pc')).toHaveLength(0);
    expect(m.container.querySelectorAll('main.pass button')).toHaveLength(0);
    // the next catch-up (the tablet set to another point) brings the Pass back
    raw(catchUp(view({ point_id: 'PT-2', orders: [order('O5', [line('C', { order_id: 'O5', point_id: 'PT-2' })])] })));
    await flush();
    expect(m.container.querySelector('[data-retired]')).toBeNull();
    expect(m.container.querySelectorAll('.pc')).toHaveLength(1);
  });
});
