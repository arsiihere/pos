import type { AlertLinkTarget } from '@pos/events';
import { describe, expect, it } from 'vitest';
import type { HubError, HubResult } from '../../api/hub-admin';
import type { OrderViewAnswer, OrderViewBody, SeatingLine, ZoneStockBody } from '../staff/orders/contracts';
import type { MapTile, TableMapBody } from '../staff/tables/contracts';
import { checkTarget, type CheckDeps, type CheckRow } from './deeplink-check';

// 01d v1.3 §3.13.3 (rows order_line, order, zone_item; a request's own state), §3.13.4, DL Q-2 (a), B1: the open
// check of a deep link, with the existing reads only.

function line(over: Partial<SeatingLine> = {}): SeatingLine {
  return {
    order_item_id: 'L1',
    order_id: 'O1',
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: 'I1',
    deal_id: null,
    name: 'Chicken Karahi',
    sale_unit: 'piece',
    quantity: 3,
    units: 3,
    live_units: 3,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 0,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 0,
    billed_minor: 0,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: 0,
    served_at: null,
    served_source: null,
    is_food: true,
    kitchen_note: null,
    stage: 'cooking',
    fired: true,
    ...over,
  };
}

function order(over: Partial<OrderViewBody> = {}): OrderViewBody {
  return {
    order_id: 'O1',
    placed_by: { staff_id: 'ST-1', name: 'Hamza' },
    placed_at: 0,
    follow_up: false,
    cancelled: false,
    billed: false,
    has_phone: false,
    promise_ms: null,
    lines: [line()],
    order_type: 'dine_in',
    seating_id: 'S4',
    ...over,
  };
}

function tile(over: Partial<MapTile> & { table_id: string }): MapTile {
  return {
    name: over.table_id,
    seats: 4,
    archived: false,
    state: 'SEATED',
    seating_id: null,
    party_size: 2,
    primary_table_id: null,
    joined_table_names: [],
    holder: null,
    assignee: null,
    lock: null,
    opened_at: 0,
    bill_requested_at: null,
    live_order_count: 1,
    ...over,
  };
}

function mapOf(tiles: MapTile[], floor_id = 'F1'): TableMapBody {
  return { as_of_seq: 1, floors: [{ floor_id, name: 'Main', archived: false, zones: [{ zone_id: null, name: null, tables: tiles }] }] };
}

// T4 + T5 merged into S4 (primary T4)
const MERGED = mapOf([
  tile({ table_id: 'T4', seating_id: 'S4', primary_table_id: 'T4', joined_table_names: ['T5'] }),
  tile({ table_id: 'T5', seating_id: 'S4', primary_table_id: 'T4' }),
]);

const ZONES: ZoneStockBody[] = [{ zone_id: 'Z1', name: 'Counter', items: [{ item_id: 'I9', name: 'Coke 345', on_hand: 2, threshold: 5 }] }];

const apiError = (status: number, code: string): HubResult<never> => ({ ok: false, error: { kind: 'api', status, code, details: {} } });

interface Calls {
  orderView: string[];
  zoneStock: Array<string | undefined>;
  tableMap: Array<string | undefined>;
}

function deps(o: {
  view?: HubResult<OrderViewAnswer> | ((id: string) => HubResult<OrderViewAnswer>);
  zones?: HubResult<ZoneStockBody[]>;
  map?: HubResult<TableMapBody>;
  held?: TableMapBody | null;
}): CheckDeps & { calls: Calls } {
  const calls: Calls = { orderView: [], zoneStock: [], tableMap: [] };
  return {
    calls,
    orders: {
      orderView: (id) => {
        calls.orderView.push(id);
        const v = o.view ?? { ok: true, data: { kind: 'order', order: order() } };
        return Promise.resolve(typeof v === 'function' ? v(id) : v);
      },
      zoneStock: (zone_id) => {
        calls.zoneStock.push(zone_id);
        return Promise.resolve(o.zones ?? { ok: true, data: ZONES });
      },
    },
    tables: {
      tableMap: (floor_id) => {
        calls.tableMap.push(floor_id);
        return Promise.resolve(o.map ?? { ok: true, data: MERGED });
      },
    },
    heldMap: () => o.held ?? null,
  };
}

const ok = (body: OrderViewBody): HubResult<OrderViewAnswer> => ({ ok: true, data: { kind: 'order', order: body } });

function row(kind: string, target: AlertLinkTarget, over: Partial<CheckRow> = {}): CheckRow {
  return { alert_id: 'A1', kind, raised_at: 1_000, state: 'open', target, ...over };
}

const LINE_T: AlertLinkTarget = { type: 'order_line', order_id: 'O1', order_item_id: 'L1' };
const ORDER_T: AlertLinkTarget = { type: 'order', order_id: 'O1' };
const ZONE_T: AlertLinkTarget = { type: 'zone_item', zone_id: 'Z1', item_id: 'I9' };

describe('[01d v1.3 §3.13.3] open check: order_line and order', () => {
  it('[01d §3.13.3] dine-in line: the body\'s seating, then its primary tile → the table sheet with focus=line; one order-view, held map', async () => {
    const d = deps({ held: MERGED });
    const r = await checkTarget(row('void_approval', LINE_T), d);
    expect(r).toEqual({
      kind: 'open',
      href: '/tables/T4?seating_id=S4&focus=line%3AL1',
      focus: { kind: 'line', order_item_id: 'L1' },
      preload: { order_view: order() },
    });
    expect(d.calls).toEqual({ orderView: ['O1'], zoneStock: [], tableMap: [] });
  });

  it('[01d §3.13.3] dine-in order with no held map: one table-map read (no floor_id); focus=order', async () => {
    const d = deps({ held: null });
    const r = await checkTarget(row('served_card', ORDER_T), d);
    expect(r).toMatchObject({ kind: 'open', href: '/tables/T4?seating_id=S4&focus=order%3AO1', focus: { kind: 'order', order_id: 'O1' } });
    expect(d.calls).toEqual({ orderView: ['O1'], zoneStock: [], tableMap: [undefined] });
  });

  it('[01d #82] B1: an order moved by TablesMerged opens the surviving seating\'s table; by SeatingSplit the new seating; takeaway opens #/orders/<id>', async () => {
    // merged: the order was raised on S5 / T5, order-view now says S4 → T4's sheet (S4)
    const merged = await checkTarget(row('comp', LINE_T), deps({ held: MERGED, view: ok(order({ seating_id: 'S4' })) }));
    expect(merged).toMatchObject({ kind: 'open', href: '/tables/T4?seating_id=S4&focus=line%3AL1' });
    // split: T4 keeps S4 (still open), the order moved to S9 on T6 → S9, not S4
    const split = mapOf([
      tile({ table_id: 'T4', seating_id: 'S4', primary_table_id: 'T4' }),
      tile({ table_id: 'T6', seating_id: 'S9', primary_table_id: 'T6' }),
    ]);
    const r = await checkTarget(row('comp', LINE_T), deps({ held: split, view: ok(order({ seating_id: 'S9' })) }));
    expect(r).toMatchObject({ kind: 'open', href: '/tables/T6?seating_id=S9&focus=line%3AL1' });
    // takeaway: order_type 'takeaway', seating_id null → #/orders/<id>, the body handed over, no map read
    const takeaway = order({ order_type: 'takeaway', seating_id: null });
    const d = deps({ view: ok(takeaway) });
    expect(await checkTarget(row('void_approval', LINE_T), d)).toEqual({
      kind: 'open',
      href: '/orders/O1?focus=line%3AL1',
      focus: { kind: 'line', order_item_id: 'L1' },
      preload: { order_view: takeaway },
    });
    expect(await checkTarget(row('ready_to_serve', ORDER_T), deps({ view: ok(order({ order_type: 'parking', seating_id: null })) }))).toMatchObject({
      kind: 'open',
      href: '/orders/O1?focus=order%3AO1',
    });
    expect(d.calls.tableMap).toEqual([]);
  });

  it('[01d #82] the client never reads the order\'s table_key (a spy on the order body)', async () => {
    const read: string[] = [];
    const body = new Proxy({ ...order({ seating_id: 'S4' }), table_key: 'dine_in:S5' } as OrderViewBody, {
      get(target, key, receiver) {
        if (typeof key === 'string') read.push(key);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const r = await checkTarget(row('comp', LINE_T), deps({ held: MERGED, view: ok(body) }));
    expect(r).toMatchObject({ kind: 'open', href: '/tables/T4?seating_id=S4&focus=line%3AL1' });
    expect(read).toContain('seating_id');
    expect(read).not.toContain('table_key');
  });

  it('[01d §3.13.3] not open: 404 ORDER_NOT_FOUND, cancelled, billed, the line missing, live_units 0', async () => {
    const cases: Array<HubResult<OrderViewAnswer>> = [
      apiError(404, 'ORDER_NOT_FOUND'),
      ok(order({ cancelled: true })),
      ok(order({ billed: true })),
      ok(order({ lines: [line({ order_item_id: 'L2' })] })),
      ok(order({ lines: [line({ live_units: 0, voided_units: 3 })] })),
    ];
    for (const view of cases) expect(await checkTarget(row('engine_line_dropped', LINE_T), deps({ held: MERGED, view }))).toEqual({ kind: 'not_open' });
    // an order target: cancelled / billed / gone
    for (const view of cases.slice(0, 3)) expect(await checkTarget(row('served_card', ORDER_T), deps({ held: MERGED, view }))).toEqual({ kind: 'not_open' });
  });

  it('[01d §3.13.3] DL Q-2 (a): a served comp / void_approval line is open; a partial void keeps the line open (m4)', async () => {
    const served = ok(order({ lines: [line({ served_at: 5_000, served_source: 'tap', stage: 'served' })] }));
    for (const kind of ['comp', 'void_approval', 'request_result']) {
      expect(await checkTarget(row(kind, LINE_T), deps({ held: MERGED, view: served })), kind).toMatchObject({ kind: 'open' });
    }
    const partial = ok(order({ lines: [line({ units: 3, live_units: 2, voided_units: 1 })] }));
    expect(await checkTarget(row('request_result', LINE_T, { state: 'closed' }), deps({ held: MERGED, view: partial }))).toMatchObject({ kind: 'open' });
  });

  it('[01d §3.13.3] DL Q-2 (a): only ready_to_serve treats "every counted line served" as not open (allServed\'s rule)', async () => {
    const allServedOrder = ok(
      order({
        lines: [
          line({ order_item_id: 'L1', served_at: 5_000, stage: 'served' }),
          line({ order_item_id: 'L2', served_at: null, stage: 'served' }),
          line({ order_item_id: 'D1', line_kind: 'deal', served_at: null, stage: null }), // a deal head is not counted
          line({ order_item_id: 'L3', live_units: 0, served_at: null }), // nothing live: not counted
        ],
      }),
    );
    expect(await checkTarget(row('ready_to_serve', ORDER_T), deps({ held: MERGED, view: allServedOrder }))).toEqual({ kind: 'not_open' });
    expect(await checkTarget(row('served_card', ORDER_T), deps({ held: MERGED, view: allServedOrder }))).toMatchObject({ kind: 'open' });
    const oneLeft = ok(order({ lines: [line({ order_item_id: 'L1', served_at: 5_000 }), line({ order_item_id: 'L2' })] }));
    expect(await checkTarget(row('ready_to_serve', ORDER_T), deps({ held: MERGED, view: oneLeft }))).toMatchObject({ kind: 'open' });
  });

  it('[01d §3.13.3; #246 review] the seating\'s primary tile on a later floor is found (every floor of the map is searched)', async () => {
    const twoFloors: TableMapBody = {
      as_of_seq: 1,
      floors: [
        { floor_id: 'F1', name: 'Ground', archived: false, zones: [{ zone_id: null, name: null, tables: [tile({ table_id: 'T1', seating_id: 'S1', primary_table_id: 'T1' })] }] },
        { floor_id: 'F2', name: 'Roof', archived: false, zones: [{ zone_id: 'Z9', name: 'Terrace', tables: [tile({ table_id: 'T8', seating_id: 'S8', primary_table_id: 'T8' })] }] },
      ],
    };
    expect(await checkTarget(row('comp', LINE_T), deps({ held: twoFloors, view: ok(order({ seating_id: 'S8' })) }))).toMatchObject({
      kind: 'open',
      href: '/tables/T8?seating_id=S8&focus=line%3AL1',
    });
  });

  it('[01d §3.13.3] dine-in: a seating with no tile on the map is not open', async () => {
    const empty = mapOf([tile({ table_id: 'T4', state: 'FREE', seating_id: null, primary_table_id: null, opened_at: null })]);
    expect(await checkTarget(row('comp', LINE_T), deps({ held: empty }))).toEqual({ kind: 'not_open' });
  });

  it('[02b §6.18a; h4 review] a dine-in order with seating_id null (placed onto a seating that was not open): the order is open, its place does not resolve → not open, no map read', async () => {
    const orphan = order({ order_type: 'dine_in', seating_id: null });
    for (const [kind, target] of [
      ['comp', LINE_T],
      ['served_card', ORDER_T],
    ] as const) {
      const d = deps({ held: null, view: ok(orphan) });
      expect(await checkTarget(row(kind, target), d), kind).toEqual({ kind: 'not_open' });
      expect(d.calls, kind).toEqual({ orderView: ['O1'], zoneStock: [], tableMap: [] });
    }
  });

  it('[01d §3.13.3; G-3] cannot check: NETWORK, 403 outside_scope, 5xx, { kind: missing }, a failed table-map', async () => {
    const network: HubError = { kind: 'network' };
    const cases: Array<[HubResult<OrderViewAnswer>, HubError]> = [
      [{ ok: false, error: network }, network],
      [apiError(403, 'PERMISSION_DENIED'), { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: {} }],
      [apiError(500, 'INTERNAL'), { kind: 'api', status: 500, code: 'INTERNAL', details: {} }],
      [apiError(503, 'SERVICE_UNAVAILABLE'), { kind: 'api', status: 503, code: 'SERVICE_UNAVAILABLE', details: {} }],
    ];
    for (const [view, error] of cases) expect(await checkTarget(row('comp', LINE_T), deps({ held: MERGED, view }))).toEqual({ kind: 'cannot_check', error });
    // G-3: a hub without the route → cannot check (never a guess)
    const missing = await checkTarget(row('comp', LINE_T), deps({ held: MERGED, view: { ok: true, data: { kind: 'missing' } } }));
    expect(missing).toMatchObject({ kind: 'cannot_check', error: { kind: 'api', status: 404, code: 'ROUTE_NOT_FOUND' } });
    // the map read fails on a dine-in order
    expect(await checkTarget(row('comp', LINE_T), deps({ held: null, map: { ok: false, error: network } }))).toEqual({ kind: 'cannot_check', error: network });
  });
});

describe('[01d v1.3 §3.13.3] open check: zone_item', () => {
  it('[01d §3.13.3] the zone and item listed → #/zones?focus=item:…; one zone-stock read with no zone_id, handed over', async () => {
    const d = deps({});
    expect(await checkTarget(row('zone_stock_low', ZONE_T), d)).toEqual({
      kind: 'open',
      href: '/zones?focus=item%3AZ1%3AI9',
      focus: { kind: 'item', zone_id: 'Z1', item_id: 'I9' },
      preload: { zone_stock: ZONES },
    });
    expect(d.calls).toEqual({ orderView: [], zoneStock: [undefined], tableMap: [] });
  });

  it('[01d #87] m3: zone-stock without the (archived) zone → not open; 404 ZONE_NOT_FOUND → not open; the item gone → not open', async () => {
    expect(await checkTarget(row('zone_stock_out', ZONE_T), deps({ zones: { ok: true, data: [] } }))).toEqual({ kind: 'not_open' });
    expect(await checkTarget(row('zone_stock_out', ZONE_T), deps({ zones: apiError(404, 'ZONE_NOT_FOUND') }))).toEqual({ kind: 'not_open' });
    const noItem: ZoneStockBody[] = [{ zone_id: 'Z1', name: 'Counter', items: [] }];
    expect(await checkTarget(row('zone_stock_low', ZONE_T), deps({ zones: { ok: true, data: noItem } }))).toEqual({ kind: 'not_open' });
    expect(await checkTarget(row('zone_stock_low', ZONE_T), deps({ zones: { ok: false, error: { kind: 'network' } } }))).toEqual({
      kind: 'cannot_check',
      error: { kind: 'network' },
    });
  });
});

describe('[01d v1.3 §3.13.3] a request\'s own state first', () => {
  it('[01d §3.13.3] a closed request (row state closed, e.g. from alert_closed) is not open, with no read', async () => {
    for (const kind of ['void_approval', 'comp', 'table_handover', 'slip_warning']) {
      const d = deps({ held: MERGED });
      const target: AlertLinkTarget = kind === 'table_handover' ? { type: 'table', table_id: 'T4', seating_id: 'S4' } : kind === 'slip_warning' ? ORDER_T : LINE_T;
      expect(await checkTarget(row(kind, target, { state: 'closed' }), d), kind).toEqual({ kind: 'request_closed' });
      expect(d.calls, kind).toEqual({ orderView: [], zoneStock: [], tableMap: [] });
    }
  });

  it('[01d §3.13.1 row 14] a copy kind is about a closed request: its own closed state is not checked', async () => {
    for (const kind of ['request_result', 'approval_receipt', 'answered_on_requester_device', 'pin_use_failed']) {
      expect(await checkTarget(row(kind, LINE_T, { state: 'closed' }), deps({ held: MERGED })), kind).toMatchObject({ kind: 'open' });
    }
  });
});

describe('[01d v1.3 §3.13.3] open check: table targets (M1)', () => {
  const CALL_T: AlertLinkTarget = { type: 'table', table_id: 'T5', seating_id: 'S5' };

  it('[01d §3.13.3] the seating\'s tile on the held map → #/tables/<primary>?seating_id=…&focus=table; no read', async () => {
    const own = mapOf([tile({ table_id: 'T5', seating_id: 'S5', primary_table_id: 'T5', opened_at: 500 })]);
    const d = deps({ held: own });
    expect(await checkTarget(row('call_waiter', CALL_T), d)).toEqual({ kind: 'open', href: '/tables/T5?seating_id=S5&focus=table', focus: { kind: 'table' } });
    expect(d.calls).toEqual({ orderView: [], zoneStock: [], tableMap: [] });
  });

  it('[01d #84] M1: S4 absorbs S5 → S4\'s sheet (T5 seated in S4, opened_at ≤ raised_at); the same for an open table_handover; a party seated after the call → not open', async () => {
    // T4's seating S4 (opened at 500) absorbed S5: T5 is now in S4, primary T4; the call was raised at 1 000
    const merged = mapOf([
      tile({ table_id: 'T4', seating_id: 'S4', primary_table_id: 'T4', opened_at: 500, joined_table_names: ['T5'] }),
      tile({ table_id: 'T5', seating_id: 'S4', primary_table_id: 'T4', opened_at: 500 }),
    ]);
    for (const kind of ['call_waiter', 'table_handover']) {
      const d = deps({ held: null, map: { ok: true, data: merged } });
      expect(await checkTarget(row(kind, CALL_T, { raised_at: 1_000 }), d), kind).toEqual({
        kind: 'open',
        href: '/tables/T4?seating_id=S4&focus=table',
        focus: { kind: 'table' },
      });
      expect(d.calls.tableMap, kind).toEqual([undefined]); // at most one table-map, every floor
    }
    // the guests left; a new party S7 sat at T5 after the call (opened_at 2 000 > raised_at 1 000)
    const newParty = mapOf([tile({ table_id: 'T5', seating_id: 'S7', primary_table_id: 'T5', opened_at: 2_000 })]);
    expect(await checkTarget(row('call_waiter', CALL_T, { raised_at: 1_000 }), deps({ held: newParty }))).toEqual({ kind: 'not_open' });
    // the guests left and the table is free
    const free = mapOf([tile({ table_id: 'T5', state: 'FREE', seating_id: null, primary_table_id: null, opened_at: null })]);
    expect(await checkTarget(row('call_waiter', CALL_T), deps({ held: free }))).toEqual({ kind: 'not_open' });
    // the table is gone from the map altogether
    expect(await checkTarget(row('call_waiter', CALL_T), deps({ held: mapOf([]) }))).toEqual({ kind: 'not_open' });
  });

  it('[01d §3.13.3 step 2; #247 review] a seating opened in the same millisecond as the alert (opened_at === raised_at) counts as the absorbing one', async () => {
    const merged = mapOf([
      tile({ table_id: 'T4', seating_id: 'S4', primary_table_id: 'T4', opened_at: 1_000 }),
      tile({ table_id: 'T5', seating_id: 'S4', primary_table_id: 'T4', opened_at: 1_000 }),
    ]);
    expect(await checkTarget(row('call_waiter', CALL_T, { raised_at: 1_000 }), deps({ held: merged }))).toMatchObject({ kind: 'open', href: '/tables/T4?seating_id=S4&focus=table' });
    // one ms later is a new party
    const later = mapOf([tile({ table_id: 'T5', seating_id: 'S7', primary_table_id: 'T5', opened_at: 1_001 })]);
    expect(await checkTarget(row('call_waiter', CALL_T, { raised_at: 1_000 }), deps({ held: later }))).toEqual({ kind: 'not_open' });
  });

  it('[01d §3.13.3 step 4; G-4] the place is the primary tile; a primary in the archived group (floor_id \'\') still opens the sheet', async () => {
    const archived: TableMapBody = {
      as_of_seq: 1,
      floors: [
        { floor_id: 'F1', name: 'Main', archived: false, zones: [{ zone_id: null, name: null, tables: [tile({ table_id: 'T5', seating_id: 'S5', primary_table_id: 'T9', opened_at: 500 })] }] },
        { floor_id: '', name: null, archived: true, zones: [{ zone_id: null, name: null, tables: [tile({ table_id: 'T9', archived: true, seating_id: 'S5', primary_table_id: 'T9', opened_at: 500 })] }] },
      ],
    };
    expect(await checkTarget(row('call_waiter', CALL_T), deps({ held: archived }))).toMatchObject({ kind: 'open', href: '/tables/T9?seating_id=S5&focus=table' });
  });

  it('[01d §3.13.3] a failed table-map read → cannot check', async () => {
    expect(await checkTarget(row('call_waiter', CALL_T), deps({ held: null, map: apiError(503, 'SERVICE_UNAVAILABLE') }))).toEqual({
      kind: 'cannot_check',
      error: { kind: 'api', status: 503, code: 'SERVICE_UNAVAILABLE', details: {} },
    });
  });
});

describe('[01d v1.3 §3.13.3] open check: slip_warning while open (m5)', () => {
  const SLIP_T: AlertLinkTarget = { type: 'order', order_id: 'O1' };
  const byId = (bodies: Record<string, OrderViewBody>) => (id: string): HubResult<OrderViewAnswer> =>
    bodies[id] === undefined ? apiError(404, 'ORDER_NOT_FOUND') : ok(bodies[id]);

  it('[01d #89] a slip over [O1, O2], O1 cancelled while the slip is open → O2\'s round / LateCard; the request is open, so it is open', async () => {
    const d = {
      ...deps({
        held: MERGED,
        view: byId({ O1: order({ order_id: 'O1', cancelled: true }), O2: order({ order_id: 'O2', seating_id: 'S4' }) }),
      }),
      openSlips: () => [{ alert_id: 'A1', order_ids: ['O1', 'O2'] }],
    };
    const r = await checkTarget(row('slip_warning', SLIP_T), d);
    expect(r).toMatchObject({ kind: 'open', href: '/tables/T4?seating_id=S4&focus=late%3AA1', focus: { kind: 'late', alert_id: 'A1' } });
    expect(d.calls.orderView).toEqual(['O1', 'O2']);
  });

  it('[01d §3.13.3 m5] the open slip is open by itself: every counted line served still opens it; not listed in open_slips → target.order_id', async () => {
    const served = order({ lines: [line({ served_at: 5_000, stage: 'served' })] });
    const d = { ...deps({ held: MERGED, view: ok(served) }), openSlips: () => [{ alert_id: 'OTHER', order_ids: ['O8'] }] };
    expect(await checkTarget(row('slip_warning', SLIP_T), d)).toMatchObject({ kind: 'open', href: '/tables/T4?seating_id=S4&focus=late%3AA1' });
    expect(d.calls.orderView).toEqual(['O1']);
    // no catch-up open_slips held at all (H5 absent) → target.order_id
    expect(await checkTarget(row('slip_warning', SLIP_T), deps({ held: MERGED }))).toMatchObject({ kind: 'open' });
  });

  it('[02b §6.18a; h4 review; #247 review] a slip whose first open order is dine-in with seating_id null: that order is the open one (not skipped); no place → no_place (today\'s tap), never not open', async () => {
    const d = {
      ...deps({ held: MERGED, view: byId({ O1: order({ order_id: 'O1', seating_id: null }), O2: order({ order_id: 'O2' }) }) }),
      openSlips: () => [{ alert_id: 'A1', order_ids: ['O1', 'O2'] }],
    };
    expect(await checkTarget(row('slip_warning', SLIP_T), d)).toEqual({ kind: 'no_place' });
    expect(d.calls.orderView).toEqual(['O1']);
  });

  it('[01d §3.13.5] a takeaway / parking slip → #/orders/<id>?focus=order:<id> (M3), the body handed over', async () => {
    const takeaway = order({ order_type: 'takeaway', seating_id: null });
    expect(await checkTarget(row('slip_warning', SLIP_T), deps({ view: ok(takeaway) }))).toEqual({
      kind: 'open',
      href: '/orders/O1?focus=order%3AO1',
      focus: { kind: 'order', order_id: 'O1' },
      preload: { order_view: takeaway },
    });
  });

  it('[01d §3.13.3 m5; #247 review] the slip is open by itself: every order cancelled or billed, or no tile → no_place (today\'s tap), never not open; a read error → cannot check', async () => {
    const gone = { ...deps({ held: MERGED, view: byId({ O1: order({ cancelled: true }), O2: order({ order_id: 'O2', billed: true }) }) }), openSlips: () => [{ alert_id: 'A1', order_ids: ['O1', 'O2'] }] };
    expect(await checkTarget(row('slip_warning', SLIP_T), gone)).toEqual({ kind: 'no_place' });
    const noTile = mapOf([tile({ table_id: 'T9', seating_id: 'S9', primary_table_id: 'T9' })]);
    expect(await checkTarget(row('slip_warning', SLIP_T), deps({ held: noTile }))).toEqual({ kind: 'no_place' });
    // a closed slip is still "the request is closed"
    expect(await checkTarget(row('slip_warning', SLIP_T, { state: 'closed' }), deps({ held: MERGED }))).toEqual({ kind: 'request_closed' });
    expect(await checkTarget(row('slip_warning', SLIP_T), deps({ held: MERGED, view: { ok: false, error: { kind: 'network' } } }))).toEqual({
      kind: 'cannot_check',
      error: { kind: 'network' },
    });
  });
});
