import type { EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { registerOrdersProjection } from '../../src/orders/index';
import { createProjectionRegistry } from '../../src/projections/registry';
import { registerTablesProjection } from '../../src/tables/index';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { appendOrder, FX, openDay, openSeating, setZoneStock } from './fixtures';

// 02b §5 / T19: the one projection `orders` (with `reset`) over the real 0013 tables, fed real events through the
// hub writer (the shared fixtures plus the events a later command or module writes, appended here as real events).
let hub: TestHub;

afterEach(async () => {
  await hub.close();
});

const STAFF = 'S_WAIT';

/** Appends one writer transaction of `events` (stream order unless given), clock +1 s first. */
function append(...events: Array<{ event_type: string; payload: object; stream_type?: EventDraft['stream_type']; stream_id: string; actor_id?: string | null }>): number {
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
        actor_id: e.actor_id === undefined ? STAFF : e.actor_id,
        device_id: 'D_FIXTURE',
      })),
    ),
  );
  return now;
}

const on = (order_id: string, event_type: string, payload: object) => ({ stream_id: order_id, event_type, payload });
const removed = (order_id: string, order_item_id: string, units?: number) =>
  on(order_id, 'ItemRemoved', units === undefined ? { order_item_id } : { order_item_id, units });
const voided = (order_id: string, order_item_id: string, units: number, money: { refund_minor?: number; comp_voided_minor?: number } = {}) =>
  on(order_id, 'ItemVoided', { order_item_id, units, ...money });
const comped = (order_id: string, order_item_id: string, units: number, value_minor: number) =>
  on(order_id, 'LineComped', {
    order_item_id,
    units,
    value_minor,
    reason_code: 'late',
    note: null,
    requester_staff_id: STAFF,
    alert_id: null,
    approver_staff_id: null,
  });
const served = (order_id: string, order_item_ids: string[], o: { source?: 'tap' | 'estimated' | 'zone'; served_at?: number } = {}) =>
  on(order_id, 'ItemServed', { order_item_ids, source: o.source ?? 'tap', ...(o.served_at === undefined ? {} : { served_at: o.served_at }) });
const billed = (order_ids: string[]) => on(order_ids[0]!, 'OrdersBilled', { order_ids, bill_id: 'B1' });
/** the test hub's branch id: the hub stream id and the catch-up branch */
const branch = (): string => hub.deps.config.provisioned!.branch_id;
const dayClosed = () => ({ stream_type: 'hub' as const, stream_id: branch(), event_type: 'BusinessDayClosed', payload: {} });

const order = (order_id: string) => hub.deps.db.prepare('SELECT * FROM orders WHERE order_id = ?').get(order_id) as Record<string, unknown> | undefined;
const line = (order_item_id: string) =>
  hub.deps.db.prepare('SELECT * FROM order_lines WHERE order_item_id = ?').get(order_item_id) as Record<string, unknown> | undefined;
const zoneCount = (zone_id: string, item_id: string) =>
  (hub.deps.db.prepare('SELECT on_hand FROM zone_stock WHERE zone_id = ? AND item_id = ?').get(zone_id, item_id) as { on_hand: number } | undefined)?.on_hand;
const ledger = (order_item_id: string) => {
  const l = line(order_item_id)!;
  const keys = ['units', 'removed_units', 'removed_minor', 'voided_units', 'refund_minor', 'comped_units', 'comp_minor', 'comp_voided_minor'] as const;
  return Object.fromEntries(keys.map((k) => [k, l[k]]));
};

async function dineIn(seating_id = 'SEAT1', table_id: string = FX.zoneTable): Promise<void> {
  hub = await createTestHub();
  openDay(hub, { stock: { [FX.stock]: 100_000 } });
  openSeating(hub, { table_id, seating_id });
}

describe('[02b §5] orders projection folds', () => {
  it('[02b §5] OrderPlaced writes the orders row; contact columns only from OrderContactSet (O17)', async () => {
    await dineIn();
    const day = hub.deps.db.prepare(`SELECT json_extract(payload, '$.business_date') AS d FROM events WHERE event_type = 'BusinessDayOpened'`).get() as { d: string };
    const dine = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'L1', item_id: FX.naan }], follow_up: true });
    const take = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'L2', item_id: FX.naan }], placed_by: 'S_CASH' });
    const park = appendOrder(hub, { order_type: 'parking', car_number: 'leb-77', lines: [{ order_item_id: 'L3', item_id: FX.naan }] });
    const placedAt = (id: string) =>
      (hub.deps.db.prepare(`SELECT recorded_at FROM events WHERE event_type = 'OrderPlaced' AND stream_id = ?`).get(id) as { recorded_at: number }).recorded_at;

    expect(order(dine.order_id)).toEqual({
      order_id: dine.order_id,
      order_type: 'dine_in',
      table_key: 'dine_in:SEAT1',
      business_date: day.d,
      token: null,
      car_number: null,
      car_type: null,
      customer_name: null,
      phone: null,
      order_note: null,
      placed_by: STAFF,
      placed_at: placedAt(dine.order_id),
      follow_up: 1,
      cancelled_at: null,
      billed_at: null,
      day_closed_at: null,
      sent_after_reconnect: 0,
    });
    expect(order(take.order_id)).toMatchObject({ order_type: 'takeaway', table_key: `takeaway:${take.order_id}`, token: 1, placed_by: 'S_CASH', follow_up: 0 });
    expect(order(park.order_id)).toMatchObject({ order_type: 'parking', table_key: 'parking:LEB77', car_number: 'leb-77', car_type: 'sedan', token: null });

    append(on(take.order_id, 'OrderContactSet', { order_id: take.order_id, customer_name: 'Ali', phone: '03001234567' }));
    expect(order(take.order_id)).toMatchObject({ customer_name: 'Ali', phone: '03001234567' });
    append(on(take.order_id, 'OrderContactSet', { order_id: take.order_id, customer_name: null, phone: null }));
    expect(order(take.order_id)).toMatchObject({ customer_name: null, phone: null });
  });

  it('[02b §3.1] an OrderPlaced that is not a 02b order (delivery, or no business_date) writes no orders row', async () => {
    await dineIn();
    const base = { table_id: null, follow_up: false, pickup_at_ms: null, order_item_ids: [], groups: [], lines: [] };
    append(on('O_DEL', 'OrderPlaced', { ...base, order_id: 'O_DEL', order_type: 'delivery', table_key: 'delivery:O_DEL', business_date: '2025-10-20' }));
    append(on('O_OLD', 'OrderPlaced', { ...base, order_id: 'O_OLD', order_type: 'takeaway', table_key: 'takeaway:O_OLD' }));
    expect(order('O_DEL')).toBeUndefined();
    expect(order('O_OLD')).toBeUndefined();
  });

  it('[02b §5] ItemAdded writes the line: §3.4 units and refundable_minor, §3.3 is_food, added_at, notes', async () => {
    await dineIn();
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);
    const o = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      lines: [
        { order_item_id: 'K', item_id: FX.piece, quantity: 2, item: { kitchen_note: 'less oil' } },
        { order_item_id: 'Ko', item_id: FX.optionItem, option_id: FX.option, parent_order_item_id: 'K', quantity: 1 },
        { order_item_id: 'F', item_id: FX.gram },
        { order_item_id: 'D', deal_id: FX.deal, quantity: 2 },
        { order_item_id: 'Da', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'D' },
        { order_item_id: 'Db', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: 'D' },
        { order_item_id: 'W', item_id: FX.ready },
        { order_item_id: 'Z', item_id: FX.zoneItem, quantity: 2, from_zone: true },
      ],
    });
    const addedAt = (hub.deps.db.prepare(`SELECT recorded_at FROM events WHERE event_type = 'OrderPlaced'`).get() as { recorded_at: number }).recorded_at;
    const added = new Map(
      (hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded'`).all() as Array<{ payload: string }>).map((r) => {
        const p = JSON.parse(r.payload) as { order_item_id: string; line_total_minor: number | null; allocated_price_minor: number | null };
        return [p.order_item_id, p];
      }),
    );

    expect(line('K')).toMatchObject({
      order_id: o.order_id,
      parent_order_item_id: null,
      line_kind: 'item',
      item_id: FX.piece,
      deal_id: null,
      name: 'Chicken Karahi',
      sale_unit: 'piece',
      quantity: 2,
      units: 2,
      line_total_minor: added.get('K')!.line_total_minor,
      refundable_minor: added.get('K')!.line_total_minor,
      served_from_zone_id: null,
      added_at: addedAt,
      served_at: null,
      served_source: null,
      is_food: 1,
      kitchen_note: 'less oil',
      return_of: null,
      returned_units: 0,
    });
    // option_child: the child quantity (childQuantity 1 × 2) is its units; refundable = its line total.
    expect(line('Ko')).toMatchObject({ line_kind: 'option_child', parent_order_item_id: 'K', units: 2, refundable_minor: 20_000, is_food: 1 });
    // g line, weight pending: units 1, quantity and total NULL, refundable 0 until LineWeightSet.
    expect(line('F')).toMatchObject({ sale_unit: 'g', quantity: null, units: 1, line_total_minor: null, refundable_minor: 0 });
    // deal: units = quantity, refundable 0 (its money lives in its parts), never food (not an engine line).
    expect(line('D')).toMatchObject({ line_kind: 'deal', units: 2, refundable_minor: 0, is_food: 0 });
    // deal parts: piece part units = part qty × deal qty; refundable = allocated (+ option charges, none here).
    expect(line('Da')).toMatchObject({ line_kind: 'deal_part', units: 2, refundable_minor: added.get('Da')!.allocated_price_minor, line_total_minor: 0 });
    expect(line('Db')).toMatchObject({ line_kind: 'deal_part', units: 4, refundable_minor: added.get('Db')!.allocated_price_minor });
    // ready item (water) and zone-served cola are never food.
    expect(line('W')).toMatchObject({ is_food: 0 });
    expect(line('Z')).toMatchObject({ is_food: 0, served_from_zone_id: FX.zone, served_source: 'zone' });
  });

  it('[02b v1.0.7 §5] ItemAdded writes options_json = ItemAdded.options as [{ name, quantity }] in order; [] → NULL (B3-2)', async () => {
    await dineIn();
    const plain = (name: string, quantity: number, price_minor = 0) => ({ option_id: `O_${name}`, modifier_group_id: 'G_PLAIN', name, price_minor, quantity, charge_minor: price_minor * quantity });
    appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      lines: [
        { order_item_id: 'K', item_id: FX.piece, quantity: 2, item: { options: [plain('No onion', 2), plain('Extra butter', 1, 5_000)] } },
        { order_item_id: 'N', item_id: FX.naan },
        { order_item_id: 'D', deal_id: FX.deal },
        { order_item_id: 'Da', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'D', item: { options: [plain('Less spicy', 1)] } },
      ],
    });
    // Only name and quantity are stored (no ids, prices or charges), in the event's order.
    expect(line('K')!.options_json).toBe('[{"name":"No onion","quantity":2},{"name":"Extra butter","quantity":1}]');
    expect(line('N')!.options_json).toBeNull();
    expect(line('D')!.options_json).toBeNull();
    expect(line('Da')!.options_json).toBe('[{"name":"Less spicy","quantity":1}]');
  });

  it('[02b §5] a repeated ItemAdded of a known id changes nothing (first copy stays, no second zone −; as 03a AD-8)', async () => {
    await dineIn();
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);
    const o = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'Z', item_id: FX.zoneItem, quantity: 2, from_zone: true }] });
    const first = line('Z');
    const copy = (hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded'`).get() as { payload: string }).payload;
    append(on(o.order_id, 'ItemAdded', { ...(JSON.parse(copy) as object), name: 'Changed' }));
    expect(line('Z')).toEqual(first);
    expect(zoneCount(FX.zone, FX.zoneItem)).toBe(3);
  });

  it('[02b §5] ItemAdded return_of sets order_lines.return_of (fix and remake); absent → NULL', async () => {
    await dineIn();
    const o = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'K', item_id: FX.piece }, { order_item_id: 'N', item_id: FX.naan }] });
    append(served(o.order_id, ['K', 'N']));
    const copy = (id: string) =>
      JSON.parse((hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.order_item_id') = ?`).get(id) as { payload: string }).payload) as object;
    // §3.8: a return line is a new line, money 0, return_of = the returned line (AD-15: ItemAdded.return_of, fix and remake)
    const returnLine = (id: string, of: string) => on(o.order_id, 'ItemAdded', { ...copy(of), order_item_id: id, price_minor: 0, line_total_minor: 0, return_of: of });
    append(returnLine('Kfix', 'K'));
    append(returnLine('Nre', 'N'), on(o.order_id, 'ItemReturned', { order_item_id: 'N', mode: 'remake', replacement_order_item_id: 'Nre' }));
    expect(line('Kfix')).toMatchObject({ return_of: 'K', refundable_minor: 0, line_total_minor: 0 });
    expect(line('Nre')).toMatchObject({ return_of: 'N', refundable_minor: 0, line_total_minor: 0 });
    expect(line('K')).toMatchObject({ return_of: null });
    expect(line('N')).toMatchObject({ return_of: null, returned_units: 1 });
  });

  it('[02b §5] ItemServed sets served_at = min(served_at, recorded_at) and served_source; a served line keeps its first serve', async () => {
    await dineIn();
    const o = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'A', item_id: FX.naan }, { order_item_id: 'B', item_id: FX.naan }, { order_item_id: 'C', item_id: FX.naan }] });
    const queuedAt = hub.clock.branchNow() - 30_000;
    const at = append(served(o.order_id, ['A'], { served_at: queuedAt }));
    expect(line('A')).toMatchObject({ served_at: queuedAt, served_source: 'tap' });
    // a served_at later than recorded_at (device clock ahead) is capped at recorded_at
    const at2 = append(served(o.order_id, ['B'], { source: 'estimated', served_at: hub.clock.branchNow() + 600_000 }));
    expect(line('B')).toMatchObject({ served_at: at2, served_source: 'estimated' });
    const at3 = append(served(o.order_id, ['C']));
    expect(line('C')).toMatchObject({ served_at: at3, served_source: 'tap' });
    append(served(o.order_id, ['A'], { source: 'estimated' }));
    expect(line('A')).toMatchObject({ served_at: queuedAt, served_source: 'tap' });
    expect(at).toBeGreaterThan(queuedAt);
  });

  it('[02b §5] LineWeightSet sets quantity, line_total_minor and refundable_minor (§3.4 Weights)', async () => {
    await dineIn();
    const o = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'F', item_id: FX.gram }] });
    append(on(o.order_id, 'LineWeightSet', { order_item_id: 'F', quantity: 1_250, line_total_minor: 500_000 }));
    expect(line('F')).toMatchObject({ quantity: 1_250, units: 1, line_total_minor: 500_000, refundable_minor: 500_000 });
    append(on(o.order_id, 'LineWeightSet', { order_item_id: 'F', quantity: 1_000, line_total_minor: 400_000 }));
    expect(line('F')).toMatchObject({ quantity: 1_000, line_total_minor: 400_000, refundable_minor: 400_000 });
  });

  it('[02b §5] ledger: comp 2 then remove 2 → comp money moves to removed_minor (§3.4, #19)', async () => {
    await dineIn();
    const o = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'N', item_id: FX.naan, quantity: 2, item: { line_total_minor: 20_000 } }] });
    append(comped(o.order_id, 'N', 2, 20_000));
    expect(ledger('N')).toMatchObject({ comped_units: 2, comp_minor: 20_000 });
    append(removed(o.order_id, 'N', 2));
    expect(ledger('N')).toEqual({ units: 2, removed_units: 2, removed_minor: 20_000, voided_units: 0, refund_minor: 0, comped_units: 0, comp_minor: 0, comp_voided_minor: 0 });
  });

  it('[02b §5] ledger: remainder share comped then taken back first (3 units of 10 001 → 3 335)', async () => {
    await dineIn();
    const o = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'N', item_id: FX.naan, quantity: 3, item: { line_total_minor: 10_001 } }] });
    append(comped(o.order_id, 'N', 3, 10_001));
    append(removed(o.order_id, 'N', 1));
    expect(ledger('N')).toMatchObject({ removed_units: 1, removed_minor: 3_335, comped_units: 2, comp_minor: 6_666 });
    append(removed(o.order_id, 'N'));
    expect(ledger('N')).toMatchObject({ removed_units: 3, removed_minor: 10_001, comped_units: 0, comp_minor: 0 });
  });

  it('[02b §5] ledger: remove takes uncomped units first at the next shares; absent units = all live units', async () => {
    await dineIn();
    const o = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'N', item_id: FX.naan, quantity: 3, item: { line_total_minor: 10_001 } }] });
    append(comped(o.order_id, 'N', 1, 3_333)); // share 0
    append(removed(o.order_id, 'N', 1)); // uncomped: share 1
    expect(ledger('N')).toMatchObject({ removed_units: 1, removed_minor: 3_333, comped_units: 1, comp_minor: 3_333 });
    append(removed(o.order_id, 'N')); // the last uncomped unit (share 2 = 3 335), then the comped one (take-back 3 333)
    expect(ledger('N')).toMatchObject({ removed_units: 3, removed_minor: 10_001, comped_units: 0, comp_minor: 0 });
  });

  it('[02b §5] ItemVoided uses its refund_minor / comp_voided_minor; void takes uncomped units first (O21)', async () => {
    await dineIn();
    const o = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      lines: [
        { order_item_id: 'N', item_id: FX.naan, quantity: 3, item: { line_total_minor: 9_000 } },
        { order_item_id: 'M', item_id: FX.naan, quantity: 2, item: { line_total_minor: 6_000 } },
      ],
    });
    // remove 1 then void 2 → the refunds are the remaining shares, total 0
    append(removed(o.order_id, 'N', 1));
    append(voided(o.order_id, 'N', 2, { refund_minor: 6_000 }));
    expect(ledger('N')).toEqual({ units: 3, removed_units: 1, removed_minor: 3_000, voided_units: 2, refund_minor: 6_000, comped_units: 0, comp_minor: 0, comp_voided_minor: 0 });
    // comp 1 then void 2: one uncomped unit, then the comped one → comp_voided_minor, never refund_minor
    append(comped(o.order_id, 'M', 1, 3_000));
    append(voided(o.order_id, 'M', 2, { refund_minor: 3_000, comp_voided_minor: 3_000 }));
    expect(ledger('M')).toEqual({ units: 2, removed_units: 0, removed_minor: 0, voided_units: 2, refund_minor: 3_000, comped_units: 0, comp_minor: 0, comp_voided_minor: 3_000 });
  });

  it('[02b §5] ItemVoided without money fields counts the units with 0 money', async () => {
    await dineIn();
    const o = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'N', item_id: FX.naan, quantity: 2 }] });
    append(voided(o.order_id, 'N', 1));
    expect(ledger('N')).toMatchObject({ voided_units: 1, refund_minor: 0, comp_voided_minor: 0 });
  });

  it('[02b §5] ItemReturned sets returned_units (money unchanged, O20); OrderCancelled sets cancelled_at', async () => {
    await dineIn();
    const o = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'N', item_id: FX.naan, quantity: 2 }] });
    append(served(o.order_id, ['N']));
    append(on(o.order_id, 'ItemReturned', { order_item_id: 'N', mode: 'remake', replacement_order_item_id: 'N2' }));
    expect(line('N')).toMatchObject({ returned_units: 2, removed_units: 0, voided_units: 0, comped_units: 0, refundable_minor: 6_000 });
    const at = append(on(o.order_id, 'OrderCancelled', { order_id: o.order_id }));
    expect(order(o.order_id)).toMatchObject({ cancelled_at: at });
  });

  it('[02b §5] zone counts (§3.10): ZoneStockSet =, ZoneStockAdded +, zone ItemAdded −, zone ItemRemoved + always, voids never', async () => {
    await dineIn();
    setZoneStock(hub, FX.zone, FX.zoneItem, 5);
    expect(zoneCount(FX.zone, FX.zoneItem)).toBe(5);
    append({ stream_type: 'table', stream_id: `zone:${FX.zone}`, event_type: 'ZoneStockAdded', payload: { zone_id: FX.zone, item_id: FX.zoneItem, quantity: 3, transfers: [] } });
    expect(zoneCount(FX.zone, FX.zoneItem)).toBe(8);
    const o = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SEAT1',
      lines: [
        { order_item_id: 'Z1', item_id: FX.zoneItem, quantity: 2, from_zone: true },
        { order_item_id: 'Z2', item_id: FX.zoneItem, quantity: 3, from_zone: true },
        { order_item_id: 'K', item_id: FX.zoneItem, quantity: 1 }, // a kitchen line of the same item: no count change
      ],
    });
    expect(zoneCount(FX.zone, FX.zoneItem)).toBe(3);
    append(removed(o.order_id, 'Z1', 1));
    expect(zoneCount(FX.zone, FX.zoneItem)).toBe(4);
    append(voided(o.order_id, 'Z2', 1, { refund_minor: 15_000 }));
    expect(zoneCount(FX.zone, FX.zoneItem)).toBe(4);
    append(removed(o.order_id, 'K'));
    expect(zoneCount(FX.zone, FX.zoneItem)).toBe(4);
    append({ stream_type: 'table', stream_id: `zone:${FX.zone}`, event_type: 'ZoneStockSet', payload: { zone_id: FX.zone, item_id: FX.zoneItem, on_hand: 10, previous: 4 } });
    expect(zoneCount(FX.zone, FX.zoneItem)).toBe(10);
    // ZoneStockAdded on an item without a row yet starts it at the quantity
    append({ stream_type: 'table', stream_id: `zone:${FX.zone}`, event_type: 'ZoneStockAdded', payload: { zone_id: FX.zone, item_id: 'I_OTHER', quantity: 4, transfers: [] } });
    expect(zoneCount(FX.zone, 'I_OTHER')).toBe(4);
  });
});

describe('[02b §3.3] billed and day close', () => {
  it('[02b #29 fold] OrdersBilled sets billed_at on every listed order, and only those', async () => {
    await dineIn();
    const a = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'A', item_id: FX.naan }] });
    const b = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'B', item_id: FX.naan }] });
    const c = appendOrder(hub, { order_type: 'parking', lines: [{ order_item_id: 'C', item_id: FX.naan }] });
    const at = append(billed([a.order_id, b.order_id]));
    expect(order(a.order_id)).toMatchObject({ billed_at: at });
    expect(order(b.order_id)).toMatchObject({ billed_at: at });
    expect(order(c.order_id)).toMatchObject({ billed_at: null });
  });

  it('[02b #30 fold] day close sets day_closed_at only on cancelled, billed or finished orders', async () => {
    await dineIn();
    const cooking = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'T1', item_id: FX.naan }] });
    const finished = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'T2', item_id: FX.naan }, { order_item_id: 'T2b', item_id: FX.naan }] });
    const cancelledO = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'T3', item_id: FX.naan }] });
    const billedDineIn = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'B1', item_id: FX.naan }] });
    const deal = appendOrder(hub, {
      order_type: 'parking',
      lines: [
        { order_item_id: 'D', deal_id: FX.deal },
        { order_item_id: 'Da', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'D' },
        { order_item_id: 'Db', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: 'D' },
      ],
    });
    append(served(finished.order_id, ['T2']));
    append(removed(finished.order_id, 'T2b')); // all lines served, removed or voided → finished
    append(removed(cancelledO.order_id, 'T3'), on(cancelledO.order_id, 'OrderCancelled', { order_id: cancelledO.order_id }));
    append(billed([billedDineIn.order_id])); // billed dine-in with an untapped line
    append(served(deal.order_id, ['Da', 'Db'])); // every part served; the deal header is never served itself
    const at = append(dayClosed());

    expect(order(cooking.order_id)).toMatchObject({ day_closed_at: null });
    for (const id of [finished.order_id, cancelledO.order_id, billedDineIn.order_id, deal.order_id]) expect(order(id)).toMatchObject({ day_closed_at: at });
  });

  it('[02b #30 fold] a carried order finished the next day leaves at the next close; a closed order keeps its first close', async () => {
    await dineIn();
    const carried = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'T1', item_id: FX.naan }] });
    const done = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'T2', item_id: FX.naan }] });
    append(served(done.order_id, ['T2']));
    const firstClose = append(dayClosed());
    expect(order(carried.order_id)).toMatchObject({ day_closed_at: null });
    expect(order(done.order_id)).toMatchObject({ day_closed_at: firstClose });

    hub.clock.advance(86_400_000);
    openDay(hub, { stock: { [FX.stock]: 100_000 } });
    append(served(carried.order_id, ['T1']));
    const secondClose = append(dayClosed());
    expect(order(carried.order_id)).toMatchObject({ day_closed_at: secondClose });
    expect(order(done.order_id)).toMatchObject({ day_closed_at: firstClose });
  });
});

// The full state of the three 02b tables and the four 02a tables, in key order.
function dump(): Record<string, unknown[]> {
  const q = (sql: string) => hub.deps.db.prepare(sql).all();
  return {
    orders: q('SELECT * FROM orders ORDER BY order_id'),
    order_lines: q('SELECT * FROM order_lines ORDER BY order_item_id'),
    zone_stock: q('SELECT * FROM zone_stock ORDER BY zone_id, item_id'),
    seatings: q('SELECT * FROM seatings ORDER BY seating_id'),
    seating_tables: q('SELECT * FROM seating_tables ORDER BY table_id'),
    seating_orders: q('SELECT * FROM seating_orders ORDER BY order_id'),
    table_locks: q('SELECT * FROM table_locks ORDER BY table_id'),
  };
}

// A fixture day touching every folded event (§5 list).
function fixtureDay(): void {
  setZoneStock(hub, FX.zone, FX.zoneItem, 6);
  openSeating(hub, { table_id: FX.table, seating_id: 'SEAT2' });
  const a = appendOrder(hub, {
    order_type: 'dine_in',
    seating_id: 'SEAT1',
    lines: [
      // B3-2: plain options ride on options_json (02b v1.0.7); a replay fills it as live did.
      {
        order_item_id: 'A1',
        item_id: FX.piece,
        quantity: 2,
        item: { options: [{ option_id: 'O_NO_ONION', modifier_group_id: 'G_PLAIN', name: 'No onion', price_minor: 0, quantity: 2, charge_minor: 0 }] },
      },
      { order_item_id: 'A1o', item_id: FX.optionItem, option_id: FX.option, parent_order_item_id: 'A1' },
      { order_item_id: 'A2', item_id: FX.gram },
      { order_item_id: 'A3', item_id: FX.naan, quantity: 3, item: { line_total_minor: 10_001 } },
      { order_item_id: 'AZ', item_id: FX.zoneItem, quantity: 2, from_zone: true },
    ],
  });
  const b = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT2', lines: [{ order_item_id: 'B1', item_id: FX.naan, quantity: 2 }, { order_item_id: 'B2', item_id: FX.ready }] });
  const t = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'T1', item_id: FX.naan }] });
  const p = appendOrder(hub, {
    order_type: 'parking',
    lines: [
      { order_item_id: 'D', deal_id: FX.deal },
      { order_item_id: 'Da', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'D', item: { options: [{ option_id: 'O_MILD', modifier_group_id: 'G_PLAIN', name: 'Mild', price_minor: 0, quantity: 1, charge_minor: 0 }] } },
      { order_item_id: 'Db', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: 'D' },
    ],
  });
  append(on(t.order_id, 'OrderContactSet', { order_id: t.order_id, customer_name: 'Sara', phone: '03211234567' }));
  append(on(a.order_id, 'LineWeightSet', { order_item_id: 'A2', quantity: 1_000, line_total_minor: 400_000 }));
  append(comped(a.order_id, 'A3', 2, 6_666));
  append(removed(a.order_id, 'A3', 1));
  append(removed(a.order_id, 'AZ', 1));
  append(voided(a.order_id, 'A1', 1, { refund_minor: 1_000 }));
  append(served(a.order_id, ['A1', 'A1o'], { served_at: hub.clock.branchNow() - 5_000 }));
  const a1 = JSON.parse(
    (hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'ItemAdded' AND json_extract(payload, '$.order_item_id') = 'A1'`).get() as { payload: string }).payload,
  ) as object;
  append(
    on(a.order_id, 'ItemAdded', { ...a1, order_item_id: 'A1r', quantity: 1, price_minor: 0, line_total_minor: 0, options: [], stock_draws: [], return_of: 'A1' }),
    on(a.order_id, 'ItemReturned', { order_item_id: 'A1', mode: 'remake', replacement_order_item_id: 'A1r' }),
  );
  append({ stream_type: 'table', stream_id: `zone:${FX.zone}`, event_type: 'ZoneStockAdded', payload: { zone_id: FX.zone, item_id: FX.zoneItem, quantity: 4, transfers: [] } });
  append({ stream_type: 'table', stream_id: `zone:${FX.zone}`, event_type: 'ZoneStockSet', payload: { zone_id: FX.zone, item_id: FX.zoneItem, on_hand: 7, previous: 9 } });
  append(removed(b.order_id, 'B1'), removed(b.order_id, 'B2'), on(b.order_id, 'OrderCancelled', { order_id: b.order_id }));
  append(served(p.order_id, ['Da', 'Db']));
  append(billed([a.order_id]));
  append(dayClosed());
}

describe('[02b #28] replay', () => {
  it('[02b #28] live projection = replayed projection over a fixture day, orders registered before and after tables', async () => {
    await dineIn();
    fixtureDay();
    const live = dump();
    expect(live.orders.length).toBe(4);
    expect(live.order_lines.length).toBe(12);
    expect(live.order_lines.find((l) => (l as { order_item_id: string }).order_item_id === 'A1r')).toMatchObject({ return_of: 'A1', refundable_minor: 0 });
    const byId = (id: string) => live.order_lines.find((l) => (l as { order_item_id: string }).order_item_id === id);
    expect(byId('A1')).toMatchObject({ options_json: '[{"name":"No onion","quantity":2}]' });
    expect(byId('Da')).toMatchObject({ options_json: '[{"name":"Mild","quantity":1}]' });
    expect(byId('A1r')).toMatchObject({ options_json: null });

    const replayWith = (register: Array<(r: ReturnType<typeof createProjectionRegistry>) => void>) => {
      hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection IN ('orders', 'tables')`).run();
      const registry = createProjectionRegistry();
      for (const r of register) r(registry);
      const { replayed } = registry.catchUp(hub.deps.db, branch());
      expect(replayed.orders).toBeGreaterThan(0);
      return dump();
    };
    expect(replayWith([registerOrdersProjection, registerTablesProjection])).toEqual(live);
    expect(replayWith([registerTablesProjection, registerOrdersProjection])).toEqual(live);
    // T19: `orders` alone (no other projection registered) replays to the same three tables.
    hub.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'orders'`).run();
    const alone = createProjectionRegistry();
    registerOrdersProjection(alone);
    alone.catchUp(hub.deps.db, branch());
    const after = dump();
    expect({ orders: after.orders, order_lines: after.order_lines, zone_stock: after.zone_stock }).toEqual({
      orders: live.orders,
      order_lines: live.order_lines,
      zone_stock: live.zone_stock,
    });
  });
});
