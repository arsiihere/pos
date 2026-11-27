import type { EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { ORDERS_EVENT_TYPES } from '../../src/orders/projection';
import { openOrderRows } from '../../src/orders/queries/open-orders';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, openDay, openSeating } from './fixtures';

// 05 §4.5 rows Q-2, Q-4, Q-5, Q-6 (02b v1.0.16 §3.1, §3.3, §3.9, §5, §6.19): the `orders` folds of the events 05
// writes, over the real tables, fed real events through the hub writer. §10 #83, #83b, #84 (fold half; the
// planCompRemoval half is ledger.test.ts). OrdersCarriedOver's schema lands here too (integrator ruling S-A (a)).
let hub: TestHub;

afterEach(async () => {
  await hub.close();
});

const STAFF = 'S_WAIT';

function append(...events: Array<{ event_type: string; payload: object; stream_type?: EventDraft['stream_type']; stream_id: string }>): number {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) =>
    tx.append(
      events.map((e) => ({
        stream_type: e.stream_type ?? 'order',
        stream_id: e.stream_id,
        event_type: e.event_type,
        schema_version: 1,
        payload: e.payload as Record<string, unknown>,
        occurred_at: now,
        actor_id: STAFF,
        device_id: 'D_FIXTURE',
      })),
    ),
  );
  return now;
}

const on = (order_id: string, event_type: string, payload: object) => ({ stream_id: order_id, event_type, payload });
const billed = (order_ids: string[]) => on(order_ids[0]!, 'OrdersBilled', { order_ids, bill_id: 'BL1' });
const unbilled = (order_ids: string[], o: { alert_id?: string } = {}) => on(order_ids[0]!, 'OrdersUnbilled', { order_ids, bill_id: 'BL1', ...o });
const comped = (order_id: string, order_item_id: string, units: number, value_minor: number) =>
  on(order_id, 'LineComped', { order_item_id, units, value_minor, reason_code: 'late', note: null, requester_staff_id: STAFF, alert_id: null, approver_staff_id: null });
const compRemoved = (order_id: string, order_item_id: string, units: number, comp_minor: number) =>
  on(order_id, 'LineCompRemoved', {
    order_item_id,
    units,
    comp_minor,
    reason_code: 'comped_by_mistake',
    has_note: false,
    note_id: null,
    requester_staff_id: STAFF,
    approver_staff_id: null,
    alert_id: null,
  });
const served = (order_id: string, order_item_ids: string[]) => on(order_id, 'ItemServed', { order_item_ids, source: 'tap' });
const branch = (): string => hub.deps.config.provisioned!.branch_id;
const dayClosed = () => ({ stream_type: 'hub' as const, stream_id: branch(), event_type: 'BusinessDayClosed', payload: {} });

/** 05 §6.24's `OrdersCarriedOver` (hub stream), folded by 02b (row Q-5); a real event through the writer. */
const carriedOver = (order_ids: string[]) => ({
  stream_type: 'hub' as const,
  stream_id: branch(),
  event_type: 'OrdersCarriedOver',
  payload: { order_ids, business_date: '2026-11-19', reason_code: 'customer_will_pay_later', has_note: false, note_id: null },
});

const order = (order_id: string) => hub.deps.db.prepare('SELECT * FROM orders WHERE order_id = ?').get(order_id) as Record<string, unknown>;
const line = (order_item_id: string) => hub.deps.db.prepare('SELECT comped_units, comp_minor FROM order_lines WHERE order_item_id = ?').get(order_item_id);
const openIds = (): string[] => openOrderRows(hub.deps.db, ['takeaway', 'parking']).map((r) => r.order_id);

async function start(): Promise<void> {
  hub = await createTestHub();
  await seedDirectory(hub);
  openDay(hub, { stock: { [FX.stock]: 100_000 } });
}

async function removeItems(order_id: string, order_item_id: string): Promise<{ status: number; code?: string }> {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/remove-items',
    headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
    payload: {
      command_id: hub.deps.ids.next(),
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'RemoveItems',
      payload: { order_id, lines: [{ order_item_id, units: 1 }] },
      occurred_at: hub.clock.branchNow(),
      actor_id: 'S_MGR',
      device_id: device.deviceId,
    },
  });
  const body = res.json() as { error?: { code: string } };
  return { status: res.statusCode, code: body.error?.code };
}

describe('[05 row Q-2] OrdersUnbilled (02b v1.0.16 §3.3)', () => {
  it('[05 #83] OrdersUnbilled clears billed_at on every listed order and only those; edits are accepted again', async () => {
    await start();
    const a = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan, quantity: 2 }] });
    const b = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B1', item_id: FX.naan }] });
    const at = append(billed([a.order_id, b.order_id]));
    expect((await removeItems(a.order_id, 'A1')).code).toBe('ORDER_BILLED');
    append(unbilled([a.order_id], { alert_id: 'A_REQ' }));
    expect(order(a.order_id)).toMatchObject({ billed_at: null });
    expect(order(b.order_id)).toMatchObject({ billed_at: at });
    expect(openIds()).toContain(a.order_id);
    // ⚠️ 02b v1.0.25 §3.3 Open (lists) (G-1, TK-5): the billed b is a paid takeaway not yet handed over, so it stays listed
    expect(openIds()).toContain(b.order_id);
    expect(await removeItems(a.order_id, 'A1')).toMatchObject({ status: 200 });
    expect(await removeItems(b.order_id, 'B1')).toMatchObject({ status: 409, code: 'ORDER_BILLED' });
    // billed again later: a new billed_at
    const again = append(billed([a.order_id]));
    expect(order(a.order_id)).toMatchObject({ billed_at: again });
    // handed over (served) and billed → gone (02b v1.0.25 §3.3)
    append(served(b.order_id, ['B1']));
    expect(openIds()).not.toContain(b.order_id);
  });

  it('[05 #83b] OrdersUnbilled clears day_closed_at: a billed order that left at the close is open again', async () => {
    await start();
    const a = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'A1', item_id: FX.naan }] });
    // ⚠️ 02b §3.3 DC-2: a paid takeaway leaves at the close only once handed over (its line served)
    append(served(a.order_id, ['A1']));
    append(billed([a.order_id]));
    const closed = append(dayClosed());
    expect(order(a.order_id)).toMatchObject({ day_closed_at: closed });
    append(unbilled([a.order_id]));
    expect(order(a.order_id)).toMatchObject({ billed_at: null, day_closed_at: null });
    expect(openIds()).toContain(a.order_id);
  });
});

describe('[05 row Q-5] OrdersCarriedOver (02b v1.0.16 §3.3)', () => {
  it('[05 #83b] a carried order keeps day_closed_at = NULL across the close and stays on open-orders; the carry applies to one close', async () => {
    await start();
    const carried = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'C1', item_id: FX.naan }] });
    const plain = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'P1', item_id: FX.naan }] });
    // both finished (served), so both would leave at the close; only the carried one stays
    append(served(carried.order_id, ['C1']), served(plain.order_id, ['P1']));
    append(carriedOver([carried.order_id]));
    expect(order(carried.order_id)).toMatchObject({ carried_over: 1 });
    expect(order(plain.order_id)).toMatchObject({ carried_over: 0 });
    const first = append(dayClosed());
    expect(order(carried.order_id)).toMatchObject({ day_closed_at: null, carried_over: 0 });
    expect(order(plain.order_id)).toMatchObject({ day_closed_at: first });
    expect(openIds()).toEqual([carried.order_id]);
    // the next close (no new carry) closes it
    hub.clock.advance(86_400_000);
    openDay(hub, { stock: { [FX.stock]: 100_000 } });
    const second = append(dayClosed());
    expect(order(carried.order_id)).toMatchObject({ day_closed_at: second, carried_over: 0 });
    expect(openIds()).toEqual([]);
  });

  it('[05 row Q-5] the orders projection lists OrdersCarriedOver, OrdersUnbilled and LineCompRemoved', () => {
    for (const t of ['OrdersUnbilled', 'LineCompRemoved', 'OrdersCarriedOver']) expect(ORDERS_EVENT_TYPES, t).toContain(t);
  });
});

describe('[05 row Q-4] LineCompRemoved (02b v1.0.16 §3.9)', () => {
  it('[05 #84] the fold takes units and comp_minor off the comp, never below 0', async () => {
    await start();
    const o = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'N', item_id: FX.naan, quantity: 3, item: { line_total_minor: 10_001 } }] });
    append(comped(o.order_id, 'N', 3, 10_001));
    append(compRemoved(o.order_id, 'N', 1, 3_335));
    expect(line('N')).toEqual({ comped_units: 2, comp_minor: 6_666 });
    append(compRemoved(o.order_id, 'N', 2, 6_666));
    expect(line('N')).toEqual({ comped_units: 0, comp_minor: 0 });
    // an over-large removal (never written by 05, which checks comped_units ≥ units) clamps at 0
    append(comped(o.order_id, 'N', 1, 3_333));
    append(compRemoved(o.order_id, 'N', 3, 9_999));
    expect(line('N')).toEqual({ comped_units: 0, comp_minor: 0 });
  });
});

describe('[05 row Q-6] orders.bill_key (02b v1.0.16 §3.1, §5)', () => {
  it('[05 row Q-6] takeaway → takeaway:<order_id>; parking → table_key:business_date; dine-in → NULL; folded from OrderPlaced only', async () => {
    await start();
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const t = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'T1', item_id: FX.naan }] });
    const p = appendOrder(hub, { order_type: 'parking', lines: [{ order_item_id: 'P1', item_id: FX.naan }] });
    const d = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'D1', item_id: FX.naan }] });
    expect(order(t.order_id)).toMatchObject({ bill_key: `takeaway:${t.order_id}` });
    const park = order(p.order_id);
    expect(park.bill_key).toBe(`${String(park.table_key)}:${String(park.business_date)}`);
    expect(String(park.table_key)).toMatch(/^parking:/);
    expect(order(d.order_id)).toMatchObject({ bill_key: null });
  });
});

async function openOrdersQuery(order_type: 'takeaway' | 'parking'): Promise<Array<{ order_id: string; from_date: string | null; business_date: string }>> {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: device.deviceId });
  const res = await hub.app.inject({ method: 'GET', url: `/queries/open-orders?order_type=${order_type}`, headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { data: { orders: Array<{ order_id: string; from_date: string | null; business_date: string }> } }).data.orders;
}

describe('[02b §3.3 DC-2] a paid takeaway / parking order not yet handed over stays open across the day close', () => {
  it('a paid pickup still waiting at the close stays on open-orders next day, its date beside the token; Handed to customer then removes it; the next close closes it', async () => {
    await start();
    const a = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'W1', item_id: FX.naan }] });
    append(billed([a.order_id]));
    const yesterday = order(a.order_id)['business_date'] as string;
    append(dayClosed());
    expect(order(a.order_id)).toMatchObject({ day_closed_at: null });
    hub.clock.advance(86_400_000);
    openDay(hub, { stock: { [FX.stock]: 100_000 } });
    const next = await openOrdersQuery('takeaway');
    expect(next.map((o) => o.order_id)).toEqual([a.order_id]);
    expect(next[0]).toMatchObject({ business_date: yesterday, from_date: yesterday });
    // Handed to customer: its last live line served → off the list at once
    append(served(a.order_id, ['W1']));
    expect(await openOrdersQuery('takeaway')).toEqual([]);
    const second = append(dayClosed());
    expect(order(a.order_id)).toMatchObject({ day_closed_at: second });
  });

  it('a paid parking order with a live line stays open; a paid dine-in order and a paid, handed-over takeaway leave (unchanged); a cancelled one leaves', async () => {
    await start();
    const parking = appendOrder(hub, { order_type: 'parking', car_number: 'LEA 1', lines: [{ order_item_id: 'K1', item_id: FX.naan }] });
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1' });
    const dineIn = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'D1', item_id: FX.naan }] });
    const handed = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'H1', item_id: FX.naan }] });
    const gone = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'X1', item_id: FX.naan }] });
    append(served(handed.order_id, ['H1']));
    append(billed([parking.order_id]), on(dineIn.order_id, 'OrdersBilled', { order_ids: [dineIn.order_id], bill_id: 'BL2' }), on(handed.order_id, 'OrdersBilled', { order_ids: [handed.order_id], bill_id: 'BL3' }));
    append(on(gone.order_id, 'OrderCancelled', { order_id: gone.order_id }));
    const closed = append(dayClosed());
    expect(order(parking.order_id)).toMatchObject({ day_closed_at: null });
    expect(order(dineIn.order_id)).toMatchObject({ day_closed_at: closed });
    expect(order(handed.order_id)).toMatchObject({ day_closed_at: closed });
    expect(order(gone.order_id)).toMatchObject({ day_closed_at: closed });
  });
});
