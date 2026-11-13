import { describe, expect, it } from 'vitest';
import { reply } from '../../../../test/dom';
import { createStaffApi } from '../api';
import { createOrdersApi } from './api';
import type { EtaDraft } from './contracts';

// 02b §6.1–§6.10, §6.14–§6.18a (W0.5): the Orders api on the staff api's command() / query().

interface Call {
  url: string;
  init: RequestInit;
}

function setup(status = 200, body: unknown = { data: { command_id: 'C', event_ids: [], result: { ok: 1 } } }) {
  const calls: Call[] = [];
  const staff = createStaffApi({
    device: { token: 'DEV', id: 'D1', type: 'tablet' },
    meta: { tenantId: 'T', branchId: 'B', branchName: 'G', hubNowMs: 0, utcOffsetMs: 0 },
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} });
      return reply(status, body);
    },
    newCommandId: () => 'NEW-ID',
    onSignedOut: () => {},
  });
  return { calls, orders: createOrdersApi(staff) };
}
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;
type Api = ReturnType<typeof setup>['orders'];

const submit = { order_id: 'O1', order_type: 'takeaway' as const, takeaway: {}, lines: [{ order_item_id: 'L1', item_id: 'I1', quantity: 2 }] };
const served = { lines: [{ order_id: 'O1', order_item_ids: ['L1'] }] };

describe('[02b §6] Orders api', () => {
  it('[02b §6] each OrdersApi command posts its kebab route; SubmitOrder and MarkServed take command_id + queuedAt', async () => {
    const cases: Array<[string, string, (a: Api) => Promise<unknown>, unknown]> = [
      ['submit-order', 'SubmitOrder', (a) => a.submitOrder(submit), submit],
      ['remove-items', 'RemoveItems', (a) => a.removeItems({ order_id: 'O1', seating_id: 'S1', lines: [{ order_item_id: 'L1', units: 1 }] }), { order_id: 'O1', seating_id: 'S1', lines: [{ order_item_id: 'L1', units: 1 }] }],
      ['set-line-weight', 'SetLineWeight', (a) => a.setLineWeight({ order_item_id: 'L1', quantity: 750 }), { order_item_id: 'L1', quantity: 750 }],
      ['mark-served', 'MarkServed', (a) => a.markServed(served), served],
      ['release-items', 'ReleaseItems', (a) => a.releaseItems({ order_ids: ['O1'], released: ['L1'], expedite: [] }), { order_ids: ['O1'], released: ['L1'], expedite: [] }],
      ['boost-order', 'BoostOrder', (a) => a.boostOrder({ order_id: 'O1' }), { order_id: 'O1' }],
      ['return-to-kitchen', 'ReturnToKitchen', (a) => a.returnToKitchen({ order_item_id: 'L1', return_order_item_id: 'L9', mode: 'remake' }), { order_item_id: 'L1', return_order_item_id: 'L9', mode: 'remake' }],
      ['comp-line', 'CompLine', (a) => a.compLine({ order_item_id: 'L1', units: 1, reason_code: 'other', note: 'cold' }), { order_item_id: 'L1', units: 1, reason_code: 'other', note: 'cold' }],
      ['add-zone-stock', 'AddZoneStock', (a) => a.addZoneStock({ zone_id: 'Z1', item_id: 'I1', quantity: 6 }), { zone_id: 'Z1', item_id: 'I1', quantity: 6 }],
      ['set-zone-stock', 'SetZoneStock', (a) => a.setZoneStock({ zone_id: 'Z1', item_id: 'I1', on_hand: 0 }), { zone_id: 'Z1', item_id: 'I1', on_hand: 0 }],
    ];
    expect(cases).toHaveLength(10);
    for (const [route, type, call, payload] of cases) {
      const s = setup();
      expect(await call(s.orders), type).toEqual({ ok: true, data: { ok: 1 } });
      const [{ url, init }] = s.calls as [Call];
      expect(url, type).toBe(`/commands/${route}`);
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body, type).toMatchObject({ command_id: 'NEW-ID', command_type: type, device_id: 'D1' });
      expect(body['payload'], type).toEqual(payload);
      expect(headersOf(init)['X-Queued-At'], type).toBeUndefined();
    }
    // a queued replay: the entry's id and queue time
    for (const [route, call] of [
      ['submit-order', (a: Api) => a.submitOrder(submit, { commandId: 'Q-1', queuedAt: 1_700_000_000_000 })],
      ['mark-served', (a: Api) => a.markServed(served, { commandId: 'Q-1', queuedAt: 1_700_000_000_000 })],
    ] as const) {
      const s = setup();
      await call(s.orders);
      const [{ url, init }] = s.calls as [Call];
      expect(url).toBe(`/commands/${route}`);
      expect(JSON.parse(init.body as string)).toMatchObject({ command_id: 'Q-1' });
      expect(headersOf(init)['X-Queued-At']).toBe('1700000000000');
    }
  });

  it('[02b §6.14] etaPreview sends ?draft=<json>; > 8 KB refused before the call', async () => {
    const draft: EtaDraft = { order_type: 'dine_in', table_id: 'TB4', seating_id: 'S1', lines: [{ key: 'k1', item_id: 'I1', quantity: 1, kitchen_note: 'کم مرچ' }] };
    const s = setup(200, { data: { as_of_seq: 4, groups: [{ promise_ms: 9, keys: ['k1'] }], lines: [{ key: 'k1', eta_ms: 9, from_stock: false, zone_served: false }] } });
    const answer = await s.orders.etaPreview(draft);
    expect(answer.ok && answer.data.groups[0]?.keys).toEqual(['k1']);
    const url = new URL(s.calls[0]!.url, 'http://hub');
    expect(url.pathname).toBe('/queries/eta-preview');
    expect(JSON.parse(url.searchParams.get('draft')!)).toEqual(draft);
    expect(s.calls[0]!.init.method).toBe('GET');

    // 8 KB is the UTF-8 size of the JSON: Urdu notes count 2 bytes a letter
    const big: EtaDraft = { order_type: 'takeaway', lines: Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, item_id: 'I1', kitchen_note: 'م'.repeat(80) })) };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(8192);
    expect(JSON.stringify(big).length).toBeLessThan(8192);
    const refused = setup();
    const r = await refused.orders.etaPreview(big);
    expect(r).toMatchObject({ ok: false, error: { kind: 'api', status: 400, code: 'VALIDATION_FAILED', details: { issues: [{ path: 'draft' }], local: true } } });
    expect(refused.calls).toHaveLength(0);
  });

  it('[02b §6.14] the 8 KB limit is exact: 8 192 bytes are sent, 8 193 refused', async () => {
    const sized = (bytes: number): EtaDraft => {
      // padded through the order note (the size check is the device's; the hub's ≤ 200 rule is not in play here)
      const base: EtaDraft = { order_type: 'takeaway', order_note: '', lines: [{ key: 'k', item_id: 'I1' }] };
      const pad = bytes - new TextEncoder().encode(JSON.stringify(base)).length;
      return { ...base, order_note: 'x'.repeat(pad) };
    };
    for (const [bytes, sent] of [[8192, 1], [8193, 0]] as const) {
      const draft = sized(bytes);
      expect(new TextEncoder().encode(JSON.stringify(draft)).length).toBe(bytes);
      const s = setup(200, { data: { as_of_seq: 1, groups: [], lines: [] } });
      await s.orders.etaPreview(draft);
      expect(s.calls, String(bytes)).toHaveLength(sent);
    }
  });

  it('[02b §6] orderView(order_id) → 404 maps to { kind: "missing" } (H3 fallback switch)', async () => {
    const missing = setup(404, { error: { code: 'ROUTE_NOT_FOUND', details: {} } });
    expect(await missing.orders.orderView('O1')).toEqual({ ok: true, data: { kind: 'missing' } });
    expect(missing.calls[0]!.url).toBe('/queries/order-view?order_id=O1');
    // a real answer: the order is gone
    const gone = setup(404, { error: { code: 'ORDER_NOT_FOUND', details: { order_id: 'O1' } } });
    expect(await gone.orders.orderView('O1')).toMatchObject({ ok: false, error: { code: 'ORDER_NOT_FOUND' } });
    // any other answer passes through unchanged: a 403 outside_scope (§6.18a), another 404 code
    const scope = setup(403, { error: { code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } } });
    expect(await scope.orders.orderView('O1')).toEqual({ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'outside_scope' } } });
    const other404 = setup(404, { error: { code: 'TABLE_NOT_FOUND', details: {} } });
    expect(await other404.orders.orderView('O1')).toMatchObject({ ok: false, error: { code: 'TABLE_NOT_FOUND' } });
    const order = { order_id: 'O1', placed_by: { staff_id: 'ST1', name: 'Ali' }, placed_at: 1, follow_up: false, cancelled: false, billed: false, has_phone: false, promise_ms: null, lines: [] };
    const found = setup(200, { data: order });
    expect(await found.orders.orderView('O1')).toEqual({ ok: true, data: { kind: 'order', order } });
  });

  it('[02b §6.15–§6.18] the queries read their routes', async () => {
    const s = setup(200, { data: {} });
    await s.orders.seatingOrders('S 1');
    await s.orders.openOrders();
    await s.orders.openOrders({ order_type: 'takeaway', abandoned: true });
    await s.orders.zoneStock();
    await s.orders.zoneStock('Z1');
    await s.orders.orderContact('O1');
    expect(s.calls.map((c) => c.url)).toEqual([
      '/queries/seating-orders?seating_id=S%201',
      '/queries/open-orders',
      '/queries/open-orders?order_type=takeaway&abandoned=true',
      '/queries/zone-stock',
      '/queries/zone-stock?zone_id=Z1',
      '/queries/order-contact?order_id=O1',
    ]);
  });
});
