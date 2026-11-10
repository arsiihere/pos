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
  it('[02b #37 totals] untouched deal: seatingTotals = deal line total, every part billed_minor 0; pending weight and return lines 0', async () => {
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
    expect(seatingTotals(hub.deps.db, 'S1')).toEqual({ total_minor: dealTotal, order_count: 1 });
    const lines = orderLines(hub.deps.db, [d.order_id]).get(d.order_id)!;
    const by = Object.fromEntries(lines.map((l) => [l.order_item_id, l]));
    expect(by.D).toMatchObject({ billed_minor: dealTotal, line_kind: 'deal' });
    expect(by.Da!.billed_minor).toBe(0);
    expect(by.Db!.billed_minor).toBe(0);
    expect(by.W).toMatchObject({ billed_minor: 0, quantity: null, line_total_minor: null });

    // money out of a part reduces the deal line, never the part's own billed_minor
    hub.deps.db.prepare('UPDATE order_lines SET refund_minor = 1000, removed_minor = 500, comp_minor = 200 WHERE order_item_id = ?').run('Db');
    const after = orderLines(hub.deps.db, [d.order_id]).get(d.order_id)!;
    expect(after.find((l) => l.order_item_id === 'D')!.billed_minor).toBe(dealTotal - 1_700);
    expect(after.find((l) => l.order_item_id === 'Db')!.billed_minor).toBe(0);
    expect(seatingTotals(hub.deps.db, 'S1').total_minor).toBe(dealTotal - 1_700);
  });

  it('[02b #37 totals] item / option_child billed_minor = refundable − comp − comp_voided − removed − refund; cancelled orders excluded, billed ones counted; return lines 0', async () => {
    await start();
    openSeating(hub, { table_id: FX.table, seating_id: 'S1' });
    const a = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'S1',
      lines: [
        { order_item_id: 'A1', item_id: FX.piece, quantity: 2 },
        { order_item_id: 'A1o', item_id: FX.optionItem, option_id: FX.option, parent_order_item_id: 'A1' },
      ],
    });
    const c = appendOrder(hub, { order_type: 'dine_in', seating_id: 'S1', lines: [{ order_item_id: 'C1', item_id: FX.naan }] });
    const before = seatingTotals(hub.deps.db, 'S1');
    expect(before.order_count).toBe(2);
    hub.deps.db.prepare('UPDATE order_lines SET comp_minor = 100, comp_voided_minor = 50, removed_minor = 25, refund_minor = 10 WHERE order_item_id = ?').run('A1o');
    const a1 = lineRow('A1')!;
    const a1o = lineRow('A1o')!;
    const lines = orderLines(hub.deps.db, [a.order_id]).get(a.order_id)!;
    expect(lines.find((l) => l.order_item_id === 'A1o')!.billed_minor).toBe((a1o.refundable_minor as number) - 185);
    expect(lines.find((l) => l.order_item_id === 'A1')!.billed_minor).toBe(a1.refundable_minor);

    // a return line (refundable 0, return_of set) contributes 0
    hub.deps.db.prepare("UPDATE order_lines SET return_of = 'A1', refundable_minor = 0 WHERE order_item_id = 'C1'").run();
    expect(orderLines(hub.deps.db, [c.order_id]).get(c.order_id)![0]).toMatchObject({ billed_minor: 0, return_of: 'A1' });

    // billed orders still count; cancelled ones do not
    hub.deps.db.prepare('UPDATE orders SET billed_at = 5 WHERE order_id = ?').run(a.order_id);
    expect(seatingTotals(hub.deps.db, 'S1').order_count).toBe(2);
    hub.deps.db.prepare('UPDATE orders SET cancelled_at = 9 WHERE order_id = ?').run(a.order_id);
    expect(seatingTotals(hub.deps.db, 'S1')).toEqual({ total_minor: 0, order_count: 1 });
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
    hub.deps.db.prepare("UPDATE orders SET phone = '0300', billed_at = 7 WHERE order_id = ?").run(ids[0]);
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
