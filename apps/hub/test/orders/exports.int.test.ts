import type { EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { orderLines, ordersOf, seatingTotals } from '../../src/orders/exports';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { statementCounter } from '../helpers/statement-counter';
import { appendOrder, FX, openDay, openSeating } from './fixtures';

// 02b §4.2 / §3.13 / §3.4 over the real 0012 / 0013 tables, fed real events through the hub writer.
let hub: TestHub;

afterEach(async () => {
  await hub.close();
});

const STAFF = 'S_WAIT';

function append(...events: Array<{ event_type: string; payload: object; stream_type?: EventDraft['stream_type']; stream_id: string }>): void {
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
}

async function start(): Promise<void> {
  hub = await createTestHub();
  openDay(hub, { stock: { [FX.stock]: 100_000 } });
}

const on = (order_id: string, event_type: string, payload: object) => ({ stream_id: order_id, event_type, payload });

const lineRow = (id: string) => hub.deps.db.prepare('SELECT * FROM order_lines WHERE order_item_id = ?').get(id) as Record<string, number | null>;

describe('[02b #29 exports] seating exports through 02a seating_orders', () => {
  it('[02b #29 exports] merge T2 into T1: the absorbed order is in the surviving seating totals and ordersOf', async () => {
    await start();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'S_T4' });
    openSeating(hub, { table_id: FX.table, seating_id: 'S_T5' });
    const a = appendOrder(hub, { order_type: 'dine_in', seating_id: 'S_T4', lines: [{ order_item_id: 'A1', item_id: FX.naan, quantity: 2 }] });
    const b = appendOrder(hub, { order_type: 'dine_in', seating_id: 'S_T5', lines: [{ order_item_id: 'B1', item_id: FX.naan, quantity: 3 }, { order_item_id: 'B2', item_id: FX.ready }] });

    expect(seatingTotals(hub.deps.db, 'S_T4')).toEqual({ total_minor: 6_000, order_count: 1 });
    expect(ordersOf(hub.deps.db, 'S_T5').map((o) => o.order_id)).toEqual([b.order_id]);

    append({
      stream_type: 'table',
      stream_id: FX.zoneTable,
      event_type: 'TablesMerged',
      payload: { into_seating_id: 'S_T4', into_table_id: FX.zoneTable, table_ids: [FX.table], absorbed_seating_id: 'S_T5', order_ids: [b.order_id], by_staff_id: STAFF },
    });

    expect(seatingTotals(hub.deps.db, 'S_T4')).toEqual({ total_minor: 6_000 + 9_000 + 8_000, order_count: 2 });
    expect(seatingTotals(hub.deps.db, 'S_T5')).toEqual({ total_minor: 0, order_count: 0 });
    const orders = ordersOf(hub.deps.db, 'S_T4');
    expect(orders.map((o) => o.order_id)).toEqual([a.order_id, b.order_id]);
    expect(orders[1]!.lines.map((l) => l.order_item_id)).toEqual(['B1', 'B2']);
    expect(ordersOf(hub.deps.db, 'S_T5')).toEqual([]);
  });
});

describe('[02b #37 totals] seatingTotals / billed_minor', () => {
  // The spec's family deal (320 000) is not in the fixture menu; the fixture deal D_COMBO (120 000) is the stand-in.
  it('[02b #37 totals] untouched fixture deal x1 (stand-in for the family deal): seatingTotals = deal line_total_minor, every part billed_minor 0', async () => {
    await start();
    openSeating(hub, { table_id: FX.table, seating_id: 'S1' });
    const d = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'S1',
      lines: [
        { order_item_id: 'D', deal_id: FX.deal, quantity: 1 },
        { order_item_id: 'Da', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'D' },
        { order_item_id: 'Db', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: 'D' },
      ],
    });
    const dealTotal = lineRow('D')!.line_total_minor!;
    expect(dealTotal).toBe(120_000);
    expect(seatingTotals(hub.deps.db, 'S1')).toEqual({ total_minor: dealTotal, order_count: 1 });
    const by = Object.fromEntries(orderLines(hub.deps.db, [d.order_id]).get(d.order_id)!.map((l) => [l.order_item_id, l]));
    expect(by.D).toMatchObject({ billed_minor: dealTotal, line_kind: 'deal' });
    expect(by.Da!.billed_minor).toBe(0);
    expect(by.Db!.billed_minor).toBe(0);
  });

  it('[02b #37 totals] deal x2 with a pending weight: part money out (real ItemRemoved / ItemVoided / LineComped) reduces the deal line only; LineWeightSet sets the weighed total', async () => {
    await start();
    openSeating(hub, { table_id: FX.table, seating_id: 'S1' });
    const d = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'S1',
      lines: [
        { order_item_id: 'D', deal_id: FX.deal, quantity: 2 },
        { order_item_id: 'Da', deal_id: FX.deal, deal_part_id: FX.dealParts[0], item_id: FX.piece, parent_order_item_id: 'D' },
        { order_item_id: 'Db', deal_id: FX.deal, deal_part_id: FX.dealParts[1], item_id: FX.naan, parent_order_item_id: 'D' },
        { order_item_id: 'W', item_id: FX.gram },
      ],
    });
    const dealTotal = lineRow('D')!.line_total_minor!;
    expect(dealTotal).toBe(240_000);
    expect(seatingTotals(hub.deps.db, 'S1')).toEqual({ total_minor: dealTotal, order_count: 1 }); // pending weight 0
    const w = orderLines(hub.deps.db, [d.order_id]).get(d.order_id)!.find((l) => l.order_item_id === 'W')!;
    expect(w).toMatchObject({ billed_minor: 0, quantity: null, line_total_minor: null });

    append(
      on(d.order_id, 'ItemRemoved', { order_item_id: 'Db', units: 1 }),
      on(d.order_id, 'ItemVoided', { order_item_id: 'Db', units: 1, refund_minor: 700 }),
      on(d.order_id, 'LineComped', { order_item_id: 'Da', units: 1, value_minor: 200, reason_code: 'late', note: null, requester_staff_id: STAFF, alert_id: null, approver_staff_id: null }),
    );
    const db = lineRow('Db')!;
    const da = lineRow('Da')!;
    expect(db.removed_minor).toBeGreaterThan(0);
    expect(db.refund_minor).toBe(700);
    expect(da.comp_minor).toBe(200);
    const out = (db.removed_minor as number) + 700 + 200;
    const after = orderLines(hub.deps.db, [d.order_id]).get(d.order_id)!;
    expect(after.find((l) => l.order_item_id === 'D')!.billed_minor).toBe(dealTotal - out);
    expect(after.find((l) => l.order_item_id === 'Da')!.billed_minor).toBe(0);
    expect(after.find((l) => l.order_item_id === 'Db')!.billed_minor).toBe(0);
    expect(seatingTotals(hub.deps.db, 'S1').total_minor).toBe(dealTotal - out);

    append(on(d.order_id, 'LineWeightSet', { order_item_id: 'W', quantity: 1_000, line_total_minor: 400_000 }));
    expect(orderLines(hub.deps.db, [d.order_id]).get(d.order_id)!.find((l) => l.order_item_id === 'W')!.billed_minor).toBe(400_000);
    expect(seatingTotals(hub.deps.db, 'S1').total_minor).toBe(dealTotal - out + 400_000);
  });

  it('[02b #37 totals] item / option_child billed_minor = refundable − comp − comp_voided − removed − refund (real events); cancelled orders excluded, billed ones counted; return lines 0', async () => {
    await start();
    openSeating(hub, { table_id: FX.table, seating_id: 'S1' });
    const a = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'S1',
      lines: [
        { order_item_id: 'N', item_id: FX.naan, quantity: 4 },
        { order_item_id: 'A1', item_id: FX.piece },
        { order_item_id: 'A1o', item_id: FX.optionItem, option_id: FX.option, parent_order_item_id: 'A1' },
      ],
    });
    // C1: a return line of N (§3.8, AD-15): a real ItemAdded with return_of and money 0
    const c = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'S1',
      lines: [{ order_item_id: 'C1', item_id: FX.naan, item: { return_of: 'N', price_minor: 0, line_total_minor: 0 } }],
    });
    expect(seatingTotals(hub.deps.db, 'S1').order_count).toBe(2);

    // naan x4 = 12 000 (3 000 a unit): remove 1 (3 000), void 1 with refund 3 000, comp 1 (3 000) -> 3 000 left billed
    append(
      on(a.order_id, 'ItemRemoved', { order_item_id: 'N', units: 1 }),
      on(a.order_id, 'ItemVoided', { order_item_id: 'N', units: 1, refund_minor: 3_000 }),
      on(a.order_id, 'LineComped', { order_item_id: 'N', units: 1, value_minor: 3_000, reason_code: 'late', note: null, requester_staff_id: STAFF, alert_id: null, approver_staff_id: null }),
      on(a.order_id, 'LineComped', { order_item_id: 'A1o', units: 1, value_minor: 4_000, reason_code: 'late', note: null, requester_staff_id: STAFF, alert_id: null, approver_staff_id: null }),
    );
    const n = lineRow('N')!;
    expect(n).toMatchObject({ removed_minor: 3_000, refund_minor: 3_000, comp_minor: 3_000, units: 4 });
    const a1o = lineRow('A1o')!;
    const lines = orderLines(hub.deps.db, [a.order_id]).get(a.order_id)!;
    expect(lines.find((l) => l.order_item_id === 'N')!.billed_minor).toBe(3_000);
    expect(lines.find((l) => l.order_item_id === 'A1o')!.billed_minor).toBe((a1o.refundable_minor as number) - 4_000);
    expect(lines.find((l) => l.order_item_id === 'A1')!.billed_minor).toBe(lineRow('A1')!.refundable_minor);

    // a void of a comped unit moves comp money to comp_voided_minor (O21): still not billed
    append(on(a.order_id, 'ItemVoided', { order_item_id: 'A1o', units: 1, comp_voided_minor: 4_000 }));
    expect(orderLines(hub.deps.db, [a.order_id]).get(a.order_id)!.find((l) => l.order_item_id === 'A1o')!.billed_minor).toBe((a1o.refundable_minor as number) - 4_000);

    // a return line contributes 0
    expect(orderLines(hub.deps.db, [c.order_id]).get(c.order_id)![0]).toMatchObject({ billed_minor: 0, return_of: 'N' });

    // billed orders still count; cancelled ones do not
    append(on(a.order_id, 'OrdersBilled', { order_ids: [a.order_id], bill_id: 'B1' }));
    expect(seatingTotals(hub.deps.db, 'S1').order_count).toBe(2);
    append(on(a.order_id, 'OrderCancelled', { order_id: a.order_id }));
    expect(seatingTotals(hub.deps.db, 'S1')).toEqual({ total_minor: 0, order_count: 1 });
    expect(ordersOf(hub.deps.db, 'S1').find((o) => o.order_id === a.order_id)).toMatchObject({ cancelled: true, billed: true });
  });
});

describe('[02b §4.2] one statement each; row shapes', () => {
  it('[02b §4.2] each export is exactly one statement over 40 orders; deterministic order; flags are booleans', async () => {
    await start();
    openSeating(hub, { table_id: FX.table, seating_id: 'S1' });
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      const o = appendOrder(hub, {
        order_type: 'dine_in',
        seating_id: 'S1',
        lines: [
          { order_item_id: `N${i}`, item_id: FX.naan },
          { order_item_id: `R${i}`, item_id: FX.ready },
        ],
      });
      ids.push(o.order_id);
    }
    append(
      on(ids[0]!, 'OrderContactSet', { order_id: ids[0], customer_name: 'Sara', phone: '03211234567' }),
      on(ids[0]!, 'OrdersBilled', { order_ids: [ids[0]], bill_id: 'B1' }),
    );
    const counter = statementCounter(hub.deps.db);

    const totals = seatingTotals(hub.deps.db, 'S1');
    expect(counter.count).toBe(1);
    expect(totals).toEqual({ total_minor: 40 * 11_000, order_count: 40 });

    counter.reset();
    const map = orderLines(hub.deps.db, ids);
    expect(counter.count).toBe(1);
    expect(map.size).toBe(40);
    expect(map.get(ids[3]!)!.map((l) => l.order_item_id)).toEqual(['N3', 'R3']);

    counter.reset();
    const orders = ordersOf(hub.deps.db, 'S1');
    expect(counter.count).toBe(1);
    expect(orders).toHaveLength(40);
    expect(orders.every((o) => o.lines.length === 2)).toBe(true);
    const sorted = [...orders].sort((x, y) => x.placed_at - y.placed_at || (x.order_id < y.order_id ? -1 : 1));
    expect(orders.map((o) => o.order_id)).toEqual(sorted.map((o) => o.order_id));
    const first = orders.find((o) => o.order_id === ids[0])!;
    expect(first).toMatchObject({ has_phone: true, billed: true, cancelled: false, follow_up: false, sent_after_reconnect: false });
    expect(first).not.toHaveProperty('phone');
    expect(first.lines[0]).toMatchObject({ order_item_id: 'N0', is_food: true, zone_served: false, live_units: 1 });
    expect(first.lines[1]).toMatchObject({ order_item_id: 'R0', is_food: false });
  });
});

describe('[02b §3.13] live orders', () => {
  it('[02b §3.13] unknown seating and empty id list read as empty', async () => {
    await start();
    expect(seatingTotals(hub.deps.db, 'NOPE')).toEqual({ total_minor: 0, order_count: 0 });
    expect(ordersOf(hub.deps.db, 'NOPE')).toEqual([]);
    expect(orderLines(hub.deps.db, []).size).toBe(0);
  });
});
