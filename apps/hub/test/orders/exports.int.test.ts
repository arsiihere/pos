import type { EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { DomainError } from '@pos/domain';
import type { CommandCtx } from '../../src/commands/registry';
import { orderLines, ordersOf, readOrder, seatingTotals } from '../../src/orders/exports';
import { currentTableOf } from '../../src/tables/reads';
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

// ------------------------------------------------------------------------------------------- readOrder (04 Q-2)

/** readOrder reads through ctx.tx.db only; a bare ctx inside a writer transaction. */
function read(order_id: string) {
  return hub.deps.writer.run((tx) => readOrder({ tx } as unknown as CommandCtx, order_id)).result;
}

describe('[02b #42 exports] readOrder (04 §4.5 Q-2; G-14, G-16)', () => {
  it('[02b #42] head carries token, car_number, car_type, business_date and table_ids in 1 statement', async () => {
    await start();
    const counter = statementCounter(hub.deps.db);
    openSeating(hub, { table_id: FX.table, seating_id: 'S1' });
    const dine = appendOrder(hub, { order_type: 'dine_in', seating_id: 'S1', lines: [{ order_item_id: 'N1', item_id: FX.naan, quantity: 2 }] });
    const take = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'N2', item_id: FX.naan }] });
    const park = appendOrder(hub, { order_type: 'parking', car_number: 'LEA-123', lines: [{ order_item_id: 'N3', item_id: FX.naan }] });
    const placed = (id: string) => hub.deps.db.prepare('SELECT business_date, token FROM orders WHERE order_id = ?').get(id) as { business_date: string; token: number | null };

    const out = hub.deps.writer.run((tx) => {
      counter.reset();
      const r = readOrder({ tx } as unknown as CommandCtx, dine.order_id);
      return { r, statements: counter.count };
    }).result;
    expect(out.statements).toBe(1);
    expect(out.r.order).toMatchObject({
      order_id: dine.order_id,
      order_type: 'dine_in',
      seating_id: 'S1',
      primary_table_id: FX.table,
      token: null,
      car_number: null,
      car_type: null,
      business_date: placed(dine.order_id).business_date,
      table_ids: [FX.table],
    });
    expect(out.r.lines.map((l) => [l.order_item_id, l.live_units])).toEqual([['N1', 2]]);

    const t = read(take.order_id).order;
    expect(t).toMatchObject({ order_type: 'takeaway', seating_id: null, primary_table_id: null, table_ids: [], car_number: null });
    expect(t.token).toBe(placed(take.order_id).token);
    expect(typeof t.token).toBe('number');
    expect(read(park.order_id).order).toMatchObject({ order_type: 'parking', token: null, car_number: 'LEA-123', car_type: 'sedan', table_ids: [] });
  });

  it('[02b #42] a tie merge (same joined_at) lists table_ids in currentTableOf order (joined_at, then table_id)', async () => {
    await start();
    // T2 opened and T1 joined in the same transaction: both rows carry the same joined_at; insertion order is T2, T1.
    hub.clock.advance(1_000);
    const now = hub.clock.branchNow();
    const env = { schema_version: 1, occurred_at: now, actor_id: STAFF, device_id: 'D_FIXTURE' };
    hub.deps.writer.run((tx) =>
      tx.append([
        { ...env, stream_type: 'table', stream_id: FX.table, event_type: 'TableOpened', payload: { table_id: FX.table, seating_id: 'S1', holder_staff_id: STAFF, party_size: null } },
        {
          ...env,
          stream_type: 'table',
          stream_id: FX.table,
          event_type: 'TablesMerged',
          payload: { into_seating_id: 'S1', into_table_id: FX.table, table_ids: [FX.zoneTable], absorbed_seating_id: null, order_ids: [], by_staff_id: STAFF },
        },
      ]),
    );
    const joined = hub.deps.db.prepare('SELECT DISTINCT joined_at FROM seating_tables WHERE seating_id = ?').all('S1');
    expect(joined).toHaveLength(1);
    const o = appendOrder(hub, { order_type: 'dine_in', seating_id: 'S1', lines: [{ order_item_id: 'N1', item_id: FX.naan }] });

    const head = read(o.order_id).order;
    expect(head.primary_table_id).toBe(FX.table);
    expect(head.table_ids).toEqual(currentTableOf(hub.deps.db, [o.order_id]).get(o.order_id)!.table_ids);
    expect(head.table_ids).toEqual([FX.zoneTable, FX.table]);
  });

  it('[02b #42] a closed (cleaned) seating gives table_ids = [] with a non-null primary_table_id (G-14)', async () => {
    await start();
    openSeating(hub, { table_id: FX.table, seating_id: 'S1' });
    const o = appendOrder(hub, { order_type: 'dine_in', seating_id: 'S1', lines: [{ order_item_id: 'W1', item_id: FX.ready }] });
    append({ stream_type: 'table', stream_id: FX.table, event_type: 'TableCleaned', payload: { seating_id: 'S1', table_ids: [FX.table], reason: 'cleaned', by_staff_id: STAFF } });

    const head = read(o.order_id).order;
    expect(head).toMatchObject({ seating_id: 'S1', primary_table_id: FX.table, table_ids: [] });
    expect(currentTableOf(hub.deps.db, [o.order_id]).has(o.order_id)).toBe(false);
  });

  it('[02b #42] unknown order → 404 ORDER_NOT_FOUND', async () => {
    await start();
    let err: unknown;
    try {
      read('NOPE');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('ORDER_NOT_FOUND');
  });
});

// ------------------------------------------------------------------------------------- station_id (04 Q-14, 02b #51)

/** order_lines.station_id and each line's ItemAdded.station_id (first copy by seq), keyed by order_item_id. */
function stationsOf(order_id: string): { column: Record<string, string | null>; payload: Record<string, string | null> } {
  const db = hub.deps.db;
  const rows = db.prepare('SELECT order_item_id, station_id FROM order_lines WHERE order_id = ? ORDER BY order_item_id').all(order_id) as Array<{ order_item_id: string; station_id: string | null }>;
  const added = db
    .prepare("SELECT json_extract(payload, '$.order_item_id') AS id, json_extract(payload, '$.station_id') AS station_id FROM events WHERE event_type = 'ItemAdded' AND stream_id = ? ORDER BY seq")
    .all(order_id) as Array<{ id: string; station_id: string | null }>;
  const payload: Record<string, string | null> = {};
  for (const a of added) if (!(a.id in payload)) payload[a.id] = a.station_id;
  return { column: Object.fromEntries(rows.map((r) => [r.order_item_id, r.station_id])), payload };
}

describe('[02b #51] order_lines.station_id (02b v1.0.12 §5, §4.2; 04 §4.5 Q-14)', () => {
  it('[02b #51] the ItemAdded fold writes ItemAdded.station_id: item, option child with its own station, deal parts, zone-routed line; a deal header NULL', async () => {
    await start();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SZ' }); // zone Z1 routes naan to S2
    const o = appendOrder(hub, {
      order_type: 'dine_in',
      seating_id: 'SZ',
      lines: [
        { order_item_id: 'K', item_id: FX.piece },
        { order_item_id: 'R', option_id: FX.option, parent_order_item_id: 'K' },
        { order_item_id: 'N', item_id: FX.naan },
        { order_item_id: 'D', deal_id: FX.deal },
        { order_item_id: 'P1', deal_part_id: FX.dealParts[0], parent_order_item_id: 'D' },
        { order_item_id: 'P2', deal_part_id: FX.dealParts[1], parent_order_item_id: 'D' },
      ],
    });
    const s = stationsOf(o.order_id);
    expect(s.column).toEqual(s.payload);
    expect(s.column).toEqual({ K: FX.station, R: FX.station, N: FX.zoneStation, D: null, P1: FX.station, P2: FX.zoneStation });
  });

  it('[02b #51] readOrder returns station_id per line, still 1 statement', async () => {
    await start();
    const o = appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'K', item_id: FX.piece },
        { order_item_id: 'D', deal_id: FX.deal },
        { order_item_id: 'P1', deal_part_id: FX.dealParts[0], parent_order_item_id: 'D' },
        { order_item_id: 'P2', deal_part_id: FX.dealParts[1], parent_order_item_id: 'D' },
        { order_item_id: 'L', item_id: FX.naan, item: { station_id: null } }, // synthetic station-less line (04 Q-13)
      ],
    });
    const counter = statementCounter(hub.deps.db);
    const out = hub.deps.writer.run((tx) => {
      counter.reset();
      const r = readOrder({ tx } as unknown as CommandCtx, o.order_id);
      return { r, statements: counter.count };
    }).result;
    expect(out.statements).toBe(1);
    expect(Object.fromEntries(out.r.lines.map((l) => [l.order_item_id, l.station_id]))).toEqual({ K: FX.station, D: null, P1: FX.station, P2: FX.station, L: null });
    expect(Object.fromEntries(out.r.lines.map((l) => [l.order_item_id, l.station_id]))).toEqual(stationsOf(o.order_id).column);
  });
});
