import type { LineDetail } from '@pos/domain';
import type { KdsStationBody, StationPlanBody, WsServerMessage } from '@pos/events';
import { describe, expect, it } from 'vitest';
import { createKdsStore } from './store';

// 03b v1.0.8 §3.3, §6.14, §6.16, §6.17 (K1): the KDS store of one station. A catch-up replaces it, `kds_lines` fills
// details, line events move rows; an event for an id the station does not hold is ignored (Q-49, #76).

const ST = 'ST-TANDOOR';

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: `O-${id}`,
    station_id: ST,
    point_id: 'P1',
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

function nowLine(id: string, over: Partial<KdsStationBody['now'][number]> = {}): KdsStationBody['now'][number] {
  return { ...detail(id), stage: 'added', fired_at: 1_000, started_at: null, mark: null, done_undone: false, ...over };
}

function body(over: Partial<KdsStationBody> = {}): KdsStationBody {
  return {
    station_id: ST,
    day_open: true,
    sound_volume: 70,
    has_printer: false,
    lanes: { lanes_on: 1, lane_count: 1 },
    now: [],
    details: [],
    ...over,
  };
}

function plan(lines: Array<{ id: string; frozen?: boolean; mark?: StationPlanBody['lines'][number]['mark'] }>): StationPlanBody {
  return {
    station_id: ST,
    as_of_seq: 1,
    lines: lines.map((l) => ({ order_item_id: l.id, order_id: `O-${l.id}`, fire_ms: 50_000, deadline_ms: 90_000, mark: l.mark ?? null, frozen: l.frozen ?? true })),
  };
}

function catchUp(b: KdsStationBody, p: StationPlanBody | null = null): WsServerMessage {
  return { type: 'catch_up', as_of_seq: 1, state: { kds_station: b, ...(p === null ? {} : { station_plan: [p] }) } };
}

let seq = 10;
function ev(event_type: string, payload: Record<string, unknown>): WsServerMessage {
  seq += 1;
  return { type: 'event', seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } };
}

function setup(start = 5_000) {
  let now = start;
  const store = createKdsStore({ stationId: ST, now: () => now });
  return { store, at: (ms: number) => (now = ms) };
}

describe('[03b §3.3] KDS store', () => {
  it('[03b §3.3] catch-up kds_station replaces the store; kds_lines fill details; an id without details shows a placeholder', () => {
    const { store } = setup();
    expect(store.snapshot().station).toBeNull();
    store.apply(catchUp(body({ now: [nowLine('A'), nowLine('B', { stage: 'cooking', started_at: 2_000 })], details: [detail('N1')] }), plan([{ id: 'N1' }, { id: 'N2' }])));
    let s = store.snapshot();
    expect(s.rows.map((r) => [r.order_item_id, r.stage])).toEqual([
      ['A', 'added'],
      ['B', 'cooking'],
    ]);
    expect(s.station?.now.map((l) => l.order_item_id)).toEqual(['A', 'B']);
    expect(s.details.get('N1')?.item_name).toBe('Naan');
    expect(s.plan?.lines.map((l) => l.order_item_id)).toEqual(['N1', 'N2']);
    // N2 is planned and has no details yet: it fires → a placeholder row in place
    store.apply(ev('FireDispatched', { station_id: ST, order_item_ids: ['N2'], load_id: null, due_at: 4_000, reason: 'scheduled' }));
    s = store.snapshot();
    expect(s.rows.map((r) => r.order_item_id)).toEqual(['A', 'B', 'N2']);
    expect(s.rows[2]!.detail).toBeNull();
    expect(s.station?.now.map((l) => l.order_item_id)).toEqual(['A', 'B']);
    // the details arrive → the row is filled where it is
    store.apply({ type: 'kds_lines', station_id: ST, lines: [detail('N2', { item_name: 'Kulcha' })] });
    s = store.snapshot();
    expect(s.rows[2]!.detail?.item_name).toBe('Kulcha');
    expect(s.station?.now.map((l) => l.order_item_id)).toEqual(['A', 'B', 'N2']);
    // another station's details are not this store's
    store.apply({ type: 'kds_lines', station_id: 'ST-OTHER', lines: [detail('X1')] });
    expect(store.snapshot().details.has('X1')).toBe(false);

    // a new catch-up (reconnect) replaces everything, the arrival times too
    store.apply(catchUp(body({ now: [nowLine('C')], sound_volume: 40 })));
    s = store.snapshot();
    expect(s.rows.map((r) => r.order_item_id)).toEqual(['C']);
    expect(s.details.has('N2')).toBe(false);
    expect(s.arrived_at.size).toBe(0);
    expect(s.plan).toBeNull();
    expect(s.station?.sound_volume).toBe(40);
  });

  it('[03b #76] an ItemStarted / ItemDone / ItemDoneUndone / FireDispatched for an unknown order_item_id is ignored', () => {
    const { store } = setup();
    store.apply(catchUp(body({ now: [nowLine('A')] }), plan([{ id: 'N1' }])));
    const before = store.snapshot();
    let calls = 0;
    store.subscribe(() => (calls += 1));
    store.apply(ev('ItemStarted', { order_item_id: 'ZZ', started_at: 6_000, source: 'tap' }));
    store.apply(ev('ItemDone', { order_item_id: 'ZZ', done_at: 6_000, source: 'tap' }));
    store.apply(ev('ItemDoneUndone', { order_item_id: 'ZZ' }));
    store.apply(ev('FireDispatched', { station_id: ST, order_item_ids: ['ZZ'], load_id: null, due_at: 6_000, reason: 'scheduled' }));
    // a fire of another station (02b H1 sends kitchen progress wider) never adds a row here, even for a known id
    store.apply(ev('FireDispatched', { station_id: 'ST-OTHER', order_item_ids: ['N1'], load_id: null, due_at: 6_000, reason: 'scheduled' }));
    store.apply(ev('ItemServed', { order_item_ids: ['ZZ'], source: 'tap' }));
    expect(store.snapshot()).toBe(before);
    expect(calls).toBe(0);
    expect(store.hold(['A', 'N1', 'ZZ'])).toEqual(['A', 'N1']);
  });

  it('[03b Q-55] a live line\'s arrival time = hub clock at frame receipt', () => {
    const { store, at } = setup(5_000);
    store.apply(catchUp(body(), plan([{ id: 'N1', mark: 'boost' }, { id: 'N2' }])));
    at(61_000);
    store.apply(ev('FireDispatched', { station_id: ST, order_item_ids: ['N1'], load_id: null, due_at: 59_000, reason: 'scheduled' }));
    at(75_500);
    store.apply(ev('ItemStarted', { order_item_id: 'N2', started_at: 75_000, source: 'tap' }));
    const s = store.snapshot();
    expect(s.arrived_at.get('N1')).toBe(61_000);
    expect(s.arrived_at.get('N2')).toBe(75_500);
    const [n1, n2] = s.rows;
    expect(n1).toMatchObject({ order_item_id: 'N1', stage: 'added', fired_at: 61_000, mark: 'boost' });
    expect(n2).toMatchObject({ order_item_id: 'N2', stage: 'cooking', started_at: 75_000 });
    // the fired lines leave the Next plan
    expect(s.plan?.lines).toEqual([]);
  });

  it('[03b §3.3] hub frame order: a commit\'s station_plan (without the fired line) comes before its FireDispatched / ItemStarted → the line still enters Now live', () => {
    const { store, at } = setup(5_000);
    store.apply(catchUp(body(), plan([{ id: 'N1', mark: 'boost' }, { id: 'N2' }, { id: 'N3' }])));
    // fires tick commit: plan frame first (N1 gone), then the event
    store.apply({ type: 'station_plan', ...plan([{ id: 'N2' }, { id: 'N3' }]) });
    at(6_000);
    store.apply(ev('FireDispatched', { station_id: ST, order_item_ids: ['N1'], load_id: null, due_at: 5_900, reason: 'scheduled' }));
    let s = store.snapshot();
    expect(s.rows.map((r) => [r.order_item_id, r.mark, r.order_id])).toEqual([['N1', 'boost', 'O-N1']]);
    expect(s.arrived_at.get('N1')).toBe(6_000);
    // a start in the same commit as the line leaving the plan (inferred start)
    store.apply({ type: 'station_plan', ...plan([{ id: 'N3' }]) });
    store.apply(ev('ItemStarted', { order_item_id: 'N2', started_at: 6_100, source: 'inferred' }));
    s = store.snapshot();
    expect(s.rows.map((r) => [r.order_item_id, r.stage])).toEqual([
      ['N1', 'added'],
      ['N2', 'cooking'],
    ]);
    // a line the plan dropped for good (no event in its commit) is not held after the next plan frame
    store.apply({ type: 'station_plan', ...plan([]) });
    store.apply({ type: 'station_plan', ...plan([]) });
    store.apply(ev('FireDispatched', { station_id: ST, order_item_ids: ['N3'], load_id: null, due_at: 7_000, reason: 'scheduled' }));
    expect(store.snapshot().rows.map((r) => r.order_item_id)).toEqual(['N1', 'N2']);
    expect(store.hold(['N3'])).toEqual([]);
  });

  it('[03b §3.3] line events move rows: start, done kept for UNDO_DONE_MS then pruned, undone back to cooking, removed / served gone', () => {
    const { store, at } = setup(10_000);
    store.apply(catchUp(body({ now: [nowLine('A'), nowLine('B'), nowLine('C'), nowLine('D', { units: 3 })] })));
    store.apply(ev('ItemStarted', { order_item_id: 'A', started_at: 10_000, source: 'tap' }));
    store.apply(ev('ItemDone', { order_item_id: 'A', done_at: 9_500, source: 'tap' }));
    // done_at is the hub's (payload), so the kept Done ends with the hub's UndoDone window
    expect(store.snapshot().rows[0]).toMatchObject({ order_item_id: 'A', stage: 'done', done_at: 9_500 });
    store.apply(ev('ItemDone', { order_item_id: 'B', done_at: 11_000, source: 'tap' }));
    store.apply(ev('ItemDoneUndone', { order_item_id: 'B' }));
    expect(store.snapshot().rows[1]).toMatchObject({ order_item_id: 'B', stage: 'cooking', done_at: null, done_undone: true });
    store.apply(ev('ItemRemoved', { order_item_id: 'C' }));
    store.apply(ev('ItemVoided', { order_item_id: 'D', units: 1 })); // partial: the row stays (kds_lines re-sends units)
    expect(store.snapshot().rows.map((r) => r.order_item_id)).toEqual(['A', 'B', 'D']);
    store.apply(ev('ItemVoided', { order_item_id: 'D', units: 3 }));
    expect(store.snapshot().rows.map((r) => r.order_item_id)).toEqual(['A', 'B']);
    // nothing reorders; Done stays inside the undo window, then goes
    at(39_499);
    store.prune();
    expect(store.snapshot().rows.map((r) => r.order_item_id)).toEqual(['A', 'B']);
    at(39_500);
    store.prune();
    expect(store.snapshot().rows.map((r) => r.order_item_id)).toEqual(['B']);
    store.apply(ev('ItemServed', { order_item_ids: ['B'], source: 'tap' }));
    expect(store.snapshot().rows).toEqual([]);
  });

  it('[03b §3.3] station frames: day, lanes, volume, has_printer and archived follow without a reconnect', () => {
    const { store } = setup();
    store.apply(catchUp(body({ day_open: false, lanes: { lanes_on: 2, lane_count: 2 } })));
    store.apply(ev('BusinessDayOpened', { business_date: '2026-11-13' }));
    expect(store.snapshot().station?.day_open).toBe(true);
    store.apply(ev('LanesSet', { station_id: ST, lanes_on: 1, lane_count: 2 }));
    store.apply(ev('LanesSet', { station_id: 'ST-OTHER', lanes_on: 3, lane_count: 3 }));
    expect(store.snapshot().station?.lanes).toEqual({ lanes_on: 1, lane_count: 2 });
    store.apply(ev('StationCapacitySet', { station_id: ST, capacity_override: 5, previous: null, reason: 'manager' }));
    expect(store.snapshot().station?.lanes).toEqual({ lanes_on: null, lane_count: 2 });
    store.apply(ev('StationScreenSet', { station_id: ST, sound_volume: 25 }));
    expect(store.snapshot().station?.sound_volume).toBe(25);
    store.apply({ type: 'station_notice', station_id: ST, kind: 'output', has_printer: true });
    expect(store.snapshot().station?.has_printer).toBe(true);
    store.apply({ type: 'station_notice', station_id: ST, kind: 'archived', open_lines: 3 });
    expect(store.snapshot().archived).toEqual({ open_lines: 3 });
    store.apply(ev('BusinessDayClosed', {}));
    expect(store.snapshot().station?.day_open).toBe(false);
  });
});
