import type { LineDetail } from '@pos/domain';
import type { KdsStationBody, WsServerMessage } from '@pos/events';
import { describe, expect, it } from 'vitest';
import type { PointLine, PointOrder, PointViewBody } from './contracts';
import { createPassStore } from './store';

// 03b v1.0.8 §3.4, §3.6, §6.15–§6.17 (P1): the Pass store of the point this tablet belongs to. A catch-up replaces it,
// `point_lines` adds / refreshes lines, kitchen-progress and Pass events update the cards; an event for an
// order_item_id the store does not hold is ignored (Q-49, #76).

const PT = 'PT-MAIN';

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id: 'ST-TANDOOR',
    point_id: PT,
    identifier: { kind: 'table', label: 'T4' },
    order_type: 'dine_in',
    item_name: 'Naan',
    units: 2,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 120_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    ...over,
  };
}

function line(id: string, over: Partial<PointLine> = {}): PointLine {
  return { ...detail(id), stage: 'added', handed_over: false, ...over };
}

function order(order_id: string, lines: PointLine[], over: Partial<PointOrder> = {}): PointOrder {
  return { order_id, identifier: { kind: 'table', label: 'T4' }, placed_at: 1_000, lines, ready: null, ...over };
}

function takeoverBody(station_id: string, over: Partial<KdsStationBody> = {}): KdsStationBody {
  return { station_id, day_open: true, sound_volume: 70, has_printer: false, lanes: { lanes_on: 1, lane_count: 1 }, now: [], details: [], ...over };
}

function view(over: Partial<PointViewBody> = {}): PointViewBody {
  return {
    point_id: PT,
    stations: [{ station_id: 'ST-TANDOOR', name: 'Tandoor', lanes: { lanes_on: 2, lane_count: 2 }, dark: false }],
    orders: [],
    takeovers: [],
    ...over,
  };
}

function catchUp(v: PointViewBody | null): WsServerMessage {
  return { type: 'catch_up', as_of_seq: 1, state: v === null ? {} : { point_view: v } };
}

let seq = 10;
function ev(event_type: string, payload: Record<string, unknown>): WsServerMessage {
  seq += 1;
  return { type: 'event', seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } };
}

function pointLines(lines: Array<LineDetail & { group_id?: string; serve_mode?: 'sync' | 'immediate' }>, point_id = PT): WsServerMessage {
  return { type: 'point_lines', point_id, lines } as WsServerMessage;
}

function setup(start = 5_000) {
  let now = start;
  const store = createPassStore({ now: () => now });
  let calls = 0;
  store.subscribe(() => (calls += 1));
  return { store, at: (ms: number) => (now = ms), calls: () => calls };
}

const stageOf = (s: ReturnType<typeof createPassStore>, id: string) =>
  s.snapshot().view?.orders.flatMap((o) => o.lines).find((l) => l.order_item_id === id)?.stage;

describe('[03b §3.4] Pass store', () => {
  it('[03b §3.4] catch-up point_view replaces the store; point_lines add details; Pass events (ReadyToServe, Handover, ReadyRetargeted…) update cards', () => {
    const { store, at } = setup();
    expect(store.snapshot().view).toBeNull();
    store.apply(catchUp(view({ orders: [order('O1', [line('A'), line('B', { stage: 'done' })])] })));
    expect(store.snapshot().view?.orders.map((o) => o.order_id)).toEqual(['O1']);
    expect(store.hold(['A', 'B', 'Z'])).toEqual(['A', 'B']);

    // point_lines: a new line of a held order joins it as waiting; a new order gets a card at the end
    store.apply(pointLines([detail('C', { item_name: 'Karahi' }), detail('D', { order_id: 'O2', identifier: { kind: 'token', token: 7, date: null } })]));
    let v = store.snapshot().view!;
    expect(v.orders.map((o) => o.order_id)).toEqual(['O1', 'O2']);
    expect(v.orders[0]!.lines.map((l) => [l.order_item_id, l.stage, l.handed_over])).toEqual([
      ['A', 'added', false],
      ['B', 'done', false],
      ['C', 'added', false],
    ]);
    expect(v.orders[1]!.identifier).toEqual({ kind: 'token', token: 7, date: null });

    // kitchen progress
    store.apply(ev('ItemStarted', { order_item_id: 'A', station_id: 'ST-TANDOOR', started_at: 4_000 }));
    expect(stageOf(store, 'A')).toBe('cooking');
    store.apply(ev('ItemDone', { order_item_id: 'A', station_id: 'ST-TANDOOR', done_at: 4_500 }));
    expect(stageOf(store, 'A')).toBe('done');
    store.apply(ev('ItemDoneUndone', { order_item_id: 'A' }));
    expect(stageOf(store, 'A')).toBe('cooking');
    store.apply(ev('ItemDone', { order_item_id: 'A', station_id: 'ST-TANDOOR', done_at: 4_600 }));

    // Ready, its retarget (no visible change), Undo
    at(6_000);
    store.apply(ev('ReadyToServe', { order_id: 'O1', point_id: PT, order_item_ids: ['A', 'B'], table_id: 'T-4', alert_id: 'AL1' }));
    expect(store.snapshot().view!.orders[0]!.ready).toEqual({ at: 6_000, by: null });
    store.apply(ev('ReadyRetargeted', { order_id: 'O1', point_id: PT, table_id: 'T-9', alert_id: 'AL2', previous_alert_id: 'AL1' }));
    expect(store.snapshot().view!.orders[0]!.ready).toEqual({ at: 6_000, by: null });
    store.apply(ev('ReadyToServeUndone', { order_id: 'O1', point_id: PT, alert_id: 'AL2' }));
    expect(store.snapshot().view!.orders[0]!.ready).toBeNull();

    // Handover marks its lines handed over; they stay until served
    store.apply(ev('Handover', { handover_id: 'H1', order_id: 'O1', point_id: PT, receiver_staff_id: 'S9', order_item_ids: ['A', 'B'], alert_id: 'AL3', ready_alert_closed: null }));
    v = store.snapshot().view!;
    expect(v.orders[0]!.lines.filter((l) => l.handed_over).map((l) => l.order_item_id)).toEqual(['A', 'B']);

    // served / removed / voided / returned lines drop off; the card drops off when none is left
    store.apply(ev('ItemServed', { order_item_ids: ['A', 'B'], source: 'tap' }));
    expect(store.snapshot().view!.orders[0]!.lines.map((l) => l.order_item_id)).toEqual(['C']);
    store.apply(ev('ItemRemoved', { order_item_id: 'C', units: 1 }));
    expect(stageOf(store, 'C')).toBe('added'); // partial: the line stays, point_lines re-sends its units
    store.apply(ev('ItemVoided', { order_item_id: 'C', units: 2 }));
    expect(store.snapshot().view!.orders.map((o) => o.order_id)).toEqual(['O2']);
    store.apply(ev('ItemReturned', { order_item_id: 'D', mode: 'remake', replacement_order_item_id: 'D2' }));
    expect(store.snapshot().view!.orders).toEqual([]);

    // an OrderCancelled drops the whole card
    store.apply(pointLines([detail('E', { order_id: 'O3' })]));
    store.apply(ev('OrderCancelled', { order_id: 'O3' }));
    expect(store.snapshot().view!.orders).toEqual([]);

    // a second catch-up replaces everything
    store.apply(catchUp(view({ orders: [order('O9', [line('X')])] })));
    expect(store.snapshot().view!.orders.map((o) => o.order_id)).toEqual(['O9']);
    expect(store.hold(['A', 'X'])).toEqual(['X']);
  });

  it('[03b §3.4 Q-47] a re-sent point_lines detail refreshes the line and the card identifier; stage and handed_over stay', () => {
    const { store } = setup();
    store.apply(catchUp(view({ orders: [order('O1', [line('A', { stage: 'done', handed_over: true })])] })));
    store.apply(pointLines([detail('A', { identifier: { kind: 'table', label: 'T9' }, units: 1 })]));
    const o = store.snapshot().view!.orders[0]!;
    expect(o.identifier).toEqual({ kind: 'table', label: 'T9' });
    expect(o.lines[0]).toMatchObject({ units: 1, stage: 'done', handed_over: true, identifier: { kind: 'table', label: 'T9' } });
  });

  it('[03b §3.4 B3-3] partial / full ItemRemoved / ItemVoided in the hub\'s order: point_lines (new units) first, then the event of the same commit', () => {
    const { store } = setup();
    store.apply(catchUp(view({ orders: [order('O1', [line('A', { units: 3 }), line('B', { units: 2 })])] })));
    // partial removal of A: 3 → 1
    store.apply(pointLines([detail('A', { units: 1 })]));
    store.apply(ev('ItemRemoved', { order_item_id: 'A', units: 2 }));
    expect(store.snapshot().view!.orders[0]!.lines.map((l) => [l.order_item_id, l.units])).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
    // a later full void of A (1 unit left) drops it
    store.apply(ev('ItemVoided', { order_item_id: 'A', units: 1 }));
    expect(store.snapshot().view!.orders[0]!.lines.map((l) => l.order_item_id)).toEqual(['B']);
    // a full void of B in hub order: point_lines B × 0 then ItemVoided { units: 2 } → gone, and the card with it
    store.apply(pointLines([detail('B', { units: 0 })]));
    store.apply(ev('ItemVoided', { order_item_id: 'B', units: 2 }));
    expect(store.snapshot().view!.orders).toEqual([]);
  });

  it('[03b Q-46] serve fields kept when present (HK2); ItemsReleased makes its released / expedite lines immediate', () => {
    const { store } = setup();
    store.apply(catchUp(view({ orders: [order('O1', [line('A', { group_id: 'G1', serve_mode: 'sync' }), line('B', { group_id: 'G1', serve_mode: 'sync' }), line('C')])] })));
    store.apply(pointLines([{ ...detail('D'), group_id: 'G2', serve_mode: 'sync' }]));
    store.apply(ev('ItemsReleased', { order_id: 'O1', alert_id: null, released: ['A'], expedite: ['D', 'NOT-HERE'] }));
    const lines = store.snapshot().view!.orders[0]!.lines;
    expect(lines.map((l) => [l.order_item_id, l.group_id, l.serve_mode])).toEqual([
      ['A', 'G1', 'immediate'],
      ['B', 'G1', 'sync'],
      ['C', undefined, undefined],
      ['D', 'G2', 'immediate'],
    ]);
  });

  it('[03b #76] kitchen-progress events of lines not held (another point) are ignored', () => {
    const { store, calls } = setup();
    store.apply(catchUp(view({ orders: [order('O1', [line('A')])] })));
    const before = store.snapshot();
    const n = calls();
    for (const f of [
      ev('ItemStarted', { order_item_id: 'OTHER', station_id: 'ST-X', started_at: 1 }),
      ev('ItemDone', { order_item_id: 'OTHER', station_id: 'ST-X', done_at: 1 }),
      ev('ItemDoneUndone', { order_item_id: 'OTHER' }),
      ev('FireDispatched', { station_id: 'ST-X', order_item_ids: ['OTHER'] }),
      ev('ItemServed', { order_item_ids: ['OTHER'], source: 'tap' }),
      ev('ItemRemoved', { order_item_id: 'OTHER' }),
      ev('ItemsReleased', { order_id: 'O7', alert_id: null, released: ['OTHER'], expedite: [] }),
      ev('ReadyToServe', { order_id: 'O7', point_id: 'PT-OTHER', order_item_ids: ['OTHER'], table_id: null, alert_id: 'AL' }),
      ev('Handover', { handover_id: 'H', order_id: 'O7', point_id: 'PT-OTHER', receiver_staff_id: 'S', order_item_ids: ['OTHER'], alert_id: 'A', ready_alert_closed: null }),
      pointLines([detail('Q', { point_id: 'PT-OTHER' })], 'PT-OTHER'),
    ])
      store.apply(f);
    expect(store.snapshot()).toBe(before);
    expect(calls()).toBe(n);
  });

  it('[03b §3.6] station_takeover active true / false opens / closes the section; station_notice output updates its has_printer', () => {
    const { store } = setup();
    store.apply(catchUp(view({ takeovers: [takeoverBody('ST-KARAHI', { has_printer: true })] })));
    expect([...store.snapshot().takeovers.keys()]).toEqual(['ST-KARAHI']);

    const nowLine = { ...detail('T1', { station_id: 'ST-TANDOOR' }), stage: 'added' as const, fired_at: 1, started_at: null, mark: null, done_undone: false };
    store.apply({ type: 'station_takeover', station_id: 'ST-TANDOOR', active: true, view: takeoverBody('ST-TANDOOR', { now: [nowLine] }) });
    expect([...store.snapshot().takeovers.keys()]).toEqual(['ST-KARAHI', 'ST-TANDOOR']);
    expect(store.snapshot().view!.stations[0]!.dark).toBe(true);
    expect(store.hold(['T1'])).toEqual(['T1']);

    store.apply({ type: 'station_notice', station_id: 'ST-TANDOOR', kind: 'output', has_printer: true });
    expect(store.snapshot().takeovers.get('ST-TANDOOR')!.has_printer).toBe(true);
    // a notice for a station not taken over changes nothing here
    const before = store.snapshot();
    store.apply({ type: 'station_notice', station_id: 'ST-ELSE', kind: 'output', has_printer: true });
    expect(store.snapshot()).toBe(before);

    store.apply({ type: 'station_notice', station_id: 'ST-TANDOOR', kind: 'archived', open_lines: 3 });
    expect(store.snapshot().archived.get('ST-TANDOOR')).toBe(3);

    store.apply({ type: 'station_takeover', station_id: 'ST-TANDOOR', active: false });
    expect([...store.snapshot().takeovers.keys()]).toEqual(['ST-KARAHI']);
    expect(store.snapshot().view!.stations[0]!.dark).toBe(false);
  });

  it('[03b Q-44] LanesSet updates a station\'s lanes live; another point\'s station is ignored', () => {
    const { store } = setup();
    store.apply(catchUp(view()));
    store.apply(ev('LanesSet', { station_id: 'ST-TANDOOR', lanes_on: 1, lane_count: 2 }));
    expect(store.snapshot().view!.stations[0]!.lanes).toEqual({ lanes_on: 1, lane_count: 2 });
    const before = store.snapshot();
    store.apply(ev('LanesSet', { station_id: 'ST-ELSE', lanes_on: 1, lane_count: 3 }));
    expect(store.snapshot()).toBe(before);
  });

  it('[03b Q-55] placed_at of a live order = first-seen time until the next catch-up', () => {
    const { store, at } = setup(5_000);
    store.apply(catchUp(view({ orders: [order('O1', [line('A')], { placed_at: 1_234 })] })));
    at(7_000);
    store.apply(pointLines([detail('B', { order_id: 'O2' })]));
    at(8_000);
    store.apply(pointLines([detail('C', { order_id: 'O2' })]));
    const s = store.snapshot();
    expect(s.view!.orders.map((o) => [o.order_id, o.placed_at])).toEqual([
      ['O1', 1_234],
      ['O2', 7_000],
    ]);
    expect(s.seen_at.get('O2')).toBe(7_000);
    store.apply(catchUp(view({ orders: [order('O2', [line('B'), line('C')], { placed_at: 6_900 })] })));
    expect(store.snapshot().view!.orders[0]!.placed_at).toBe(6_900);
    expect(store.snapshot().seen_at.size).toBe(0);
  });

  it('[03b Q-55] a live ReadyToServe → at = hub clock at receipt; by = the person this device claimed it for, else none', () => {
    const { store, at } = setup(5_000);
    store.apply(catchUp(view({ orders: [order('O1', [line('A', { stage: 'done' })]), order('O2', [line('B', { order_id: 'O2', stage: 'done' })])] })));
    // the reply can come before or after the frame
    store.claimReady('AL1', 'S-ASIF');
    at(9_000);
    store.apply(ev('ReadyToServe', { order_id: 'O1', point_id: PT, order_item_ids: ['A'], table_id: null, alert_id: 'AL1' }));
    at(9_500);
    store.apply(ev('ReadyToServe', { order_id: 'O2', point_id: PT, order_item_ids: ['B'], table_id: null, alert_id: 'AL2' }));
    expect(store.snapshot().view!.orders[1]!.ready).toEqual({ at: 9_500, by: null });
    store.claimReady('AL2', 'S-ASIF');
    const v = store.snapshot().view!;
    expect(v.orders[0]!.ready).toEqual({ at: 9_000, by: 'S-ASIF' });
    expect(v.orders[1]!.ready).toEqual({ at: 9_500, by: 'S-ASIF' });
    expect(store.snapshot().seen_at.get('ready:O1')).toBe(9_000);
    // someone else's Ready (no claim) carries no name; a catch-up brings the hub's time and id
    store.apply(ev('ReadyToServeUndone', { order_id: 'O2', point_id: PT, alert_id: 'AL2' }));
    store.apply(ev('ReadyToServe', { order_id: 'O2', point_id: PT, order_item_ids: ['B'], table_id: null, alert_id: 'AL5' }));
    expect(store.snapshot().view!.orders[1]!.ready?.by).toBeNull();
    store.apply(catchUp(view({ orders: [order('O2', [line('B', { order_id: 'O2', stage: 'done' })], { ready: { at: 9_400, by: 'S-ZAIN' } })] })));
    expect(store.snapshot().view!.orders[0]!.ready).toEqual({ at: 9_400, by: 'S-ZAIN' });
  });

  it('[03b Q-55] a Ready made by this tablet\'s own Handover (alert_id null) shows this tablet\'s person, before or after the reply', () => {
    for (const replyFirst of [true, false]) {
      const { store } = setup(5_000);
      store.apply(catchUp(view({ orders: [order('O1', [line('A', { stage: 'done' })])] })));
      if (replyFirst) store.claimHandover('H1', 'S-ASIF');
      store.apply(ev('ReadyToServe', { order_id: 'O1', point_id: PT, order_item_ids: ['A'], table_id: null, alert_id: null }));
      store.apply(ev('Handover', { handover_id: 'H1', order_id: 'O1', point_id: PT, receiver_staff_id: 'S9', order_item_ids: ['A'], alert_id: 'AL3', ready_alert_closed: null }));
      if (!replyFirst) store.claimHandover('H1', 'S-ASIF');
      expect(store.snapshot().view!.orders[0]!.ready).toEqual({ at: 5_000, by: 'S-ASIF' });
    }
    // another tablet's Handover (no claim) leaves the Ready without a name; an open Ready with an alert keeps its own
    const { store } = setup(5_000);
    store.apply(catchUp(view({ orders: [order('O1', [line('A', { stage: 'done' })])] })));
    store.apply(ev('ReadyToServe', { order_id: 'O1', point_id: PT, order_item_ids: ['A'], table_id: null, alert_id: 'AL1' }));
    store.claimHandover('H2', 'S-ASIF');
    store.apply(ev('Handover', { handover_id: 'H2', order_id: 'O1', point_id: PT, receiver_staff_id: 'S9', order_item_ids: ['A'], alert_id: 'AL3', ready_alert_closed: null }));
    expect(store.snapshot().view!.orders[0]!.ready?.by).toBeNull();
  });

  it('[03b §3.4] a frame before the first catch-up and a catch-up without point_view leave no view', () => {
    const { store } = setup();
    store.apply(pointLines([detail('A')]));
    store.apply(ev('ItemStarted', { order_item_id: 'A' }));
    expect(store.snapshot().view).toBeNull();
    store.apply(catchUp(null));
    expect(store.snapshot().view).toBeNull();
    store.apply(catchUp({ point_id: 7 } as unknown as PointViewBody));
    expect(store.snapshot().view).toBeNull();
  });
});
