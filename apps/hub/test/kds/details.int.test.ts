import type { LineDetail } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type { BranchConfig, EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLineDetails, pointOfLine } from '../../src/kds/contracts';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, append, appendOrder, fixtureMenu, openDay, openSeating, removeLine, voidLine } from './fixtures';

// 03b §3.1 (identity, point of a line), §4.2 (buildLineDetails 2 statements, pointOfLine 0), §4.4 (LineDetail), task
// b11. Orders are real submit batches (02b fixtures); table moves, cooking, serving and the return are real events.

let hub: TestHub;
afterEach(async () => {
  swapBranchConfig(null);
  await hub?.close();
});

const engine = (): EngineState => hub.deps.state.get() as EngineState;
const details = (ids: string[]): Map<string, LineDetail> => buildLineDetails(hub.deps.db, engine(), ids);

/** fixtureMenu with all-digit table names ("4", "5"), a named table ("Family 2") and a second point P2. */
function menu(): BranchConfig {
  const m = fixtureMenu();
  const floor = m.floors[0]!;
  return {
    ...m,
    points: [...m.points, { ...m.points[0]!, point_id: 'P2', name: 'Pass 2', sort_order: 1 }],
    floors: [
      {
        ...floor,
        tables: [
          { ...floor.tables[0]!, name: '4' },
          { ...floor.tables[1]!, name: '5' },
          { table_id: 'T3', name: 'Family 2', seats: 6, sort_order: 2, zone_id: null },
        ],
      },
    ],
  };
}

async function start(): Promise<void> {
  hub = await createTestHub({ provisioned: true });
  await seedDirectory(hub, await aDirectory());
  openDay(hub, { menu: menu() });
}

const tableDraft = (table_id: string, event_type: string, payload: Record<string, unknown>): Omit<EventDraft, 'occurred_at' | 'actor_id' | 'device_id' | 'schema_version'> => ({
  stream_type: 'table',
  stream_id: table_id,
  event_type,
  payload,
});

describe('[03b §3.1, §4.2] buildLineDetails / pointOfLine (b11)', () => {
  it('[03b §3.1] identifier per order type: tables by current seating, primary first, "T" only for all-digit names (P-1); token; parking', async () => {
    await start();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SE1' });
    const dine = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SE1', lines: [{ order_item_id: 'D1', item_id: FX.piece }] });
    openSeating(hub, { table_id: 'T3', seating_id: 'SE3' });
    appendOrder(hub, { order_type: 'dine_in', seating_id: 'SE3', lines: [{ order_item_id: 'F1', item_id: FX.piece }] });
    const take = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'K1', item_id: FX.piece }] });
    appendOrder(hub, { order_type: 'parking', car_number: 'LEB 1234', lines: [{ order_item_id: 'P1L', item_id: FX.piece }] });

    expect(details(['D1']).get('D1')!.identifier).toEqual({ kind: 'table', label: 'T4' });
    // 02a merge: table "5" joins seating SE1 → "T4 + T5", primary first.
    append(hub, [
      tableDraft(FX.zoneTable, 'TablesMerged', {
        into_seating_id: 'SE1',
        into_table_id: FX.zoneTable,
        table_ids: [FX.table],
        absorbed_seating_id: null,
        order_ids: [],
        by_staff_id: 'S_WAIT',
      }),
    ]);
    const { token } = hub.deps.db.prepare('SELECT token FROM orders WHERE order_id = ?').get(take.order_id) as { token: number };
    const got = details(['D1', 'F1', 'K1', 'P1L']);
    expect(got.get('D1')!.identifier).toEqual({ kind: 'table', label: 'T4 + T5' });
    expect(got.get('D1')!.order_type).toBe('dine_in');
    expect(got.get('D1')!.order_id).toBe(dine.order_id);
    expect(got.get('F1')!.identifier).toEqual({ kind: 'table', label: 'Family 2' });
    expect(got.get('K1')!.identifier).toEqual({ kind: 'token', token, date: null });
    expect(got.get('K1')!.order_type).toBe('takeaway');
    expect(got.get('P1L')!.identifier).toEqual({ kind: 'parking', car_number: 'LEB 1234', car_type: 'sedan' });
  });

  it('[03b §3.1] a takeaway token from an earlier business date carries that date ("#12 10 Nov")', async () => {
    await start();
    const first = engine().business_day!.business_date;
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'K1', item_id: FX.piece }] });
    hub.clock.advance(24 * 3_600_000);
    openDay(hub, { menu: menu() });
    expect(engine().business_day!.business_date).not.toBe(first);
    expect(engine().lines.K1, 'the earlier order is still in the engine').toBeDefined();
    expect(details(['K1']).get('K1')!.identifier).toEqual({ kind: 'token', token: 1, date: first });
  });

  it('[03b §4.4] parent / deal / options: a child at its own station names its parent, a deal part its deal, station-less option children ride on the parent', async () => {
    await start();
    appendOrder(hub, {
      order_type: 'takeaway',
      lines: [
        { order_item_id: 'K1', item_id: FX.piece, item: { kitchen_note: 'less spicy' } },
        // An option child at a station (Raita on S1) is its own engine line …
        { order_item_id: 'C1', option_id: FX.option, parent_order_item_id: 'K1' },
        // … one with no station is not, so it is listed on its parent; a removed one is not.
        { order_item_id: 'C2', option_id: FX.option, parent_order_item_id: 'K1', item: { name: 'Extra butter', station_id: null } },
        { order_item_id: 'C3', option_id: FX.option, parent_order_item_id: 'K1', item: { name: 'Gone', station_id: null } },
        { order_item_id: 'DL', deal_id: FX.deal },
        { order_item_id: 'DM', deal_part_id: FX.dealParts[0], parent_order_item_id: 'DL' },
        { order_item_id: 'DB', deal_part_id: FX.dealParts[1], parent_order_item_id: 'DL' },
      ],
    });
    const order_id = engine().lines.K1!.order_id;
    removeLine(hub, order_id, 'C3');
    voidLine(hub, order_id, 'DB', 1);
    expect(engine().lines.C2, 'a station-less option child is no engine line').toBeUndefined();

    const got = details(['K1', 'C1', 'C2', 'DL', 'DM', 'DB']);
    expect([...got.keys()].sort(), 'only engine lines have details (no deal header, no station-less child)').toEqual(['C1', 'DB', 'DM', 'K1']);
    const line = engine().lines.K1!;
    expect(got.get('K1')).toEqual({
      order_item_id: 'K1',
      order_id,
      station_id: FX.station,
      point_id: 'P1',
      identifier: { kind: 'token', token: 1, date: null },
      order_type: 'takeaway',
      item_name: 'Chicken Karahi',
      units: 1,
      line_kind: 'item',
      for_parent: null,
      deal_name: null,
      options: ['Extra butter'],
      kitchen_note: 'less spicy',
      order_note: null,
      return_of: null,
      cook_ms: line.cook_ms,
      prep_ms: line.prep_ms,
      from_stock: line.from_stock,
      placed_by_name: 'Order taker',
    } satisfies LineDetail);
    expect(got.get('C1')).toMatchObject({ line_kind: 'option_child', item_name: 'Raita', for_parent: 'Chicken Karahi', deal_name: null, options: [] });
    expect(got.get('DM')).toMatchObject({ line_kind: 'deal_part', item_name: 'Chicken Karahi', for_parent: null, deal_name: 'Karahi combo', units: 1 });
    // Live units = units − removed − voided (2 naan, 1 voided).
    expect(got.get('DB')).toMatchObject({ line_kind: 'deal_part', item_name: 'Naan', deal_name: 'Karahi combo', units: 1 });
  });

  it('[03b §4.4] return_of: the returned line, the mode from the engine and its order identifier; the order taker', async () => {
    await start();
    openSeating(hub, { table_id: 'T3', seating_id: 'SE3' });
    const { order_id } = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SE3', placed_by: 'S_CASH', lines: [{ order_item_id: 'N1', item_id: FX.naan }] });
    const station_id = engine().lines.N1!.station_id;
    const on = (event_type: string, payload: Record<string, unknown>) => ({ stream_type: 'order' as const, stream_id: order_id, event_type, payload });
    append(hub, [{ stream_type: 'station', stream_id: station_id, event_type: 'FireDispatched', payload: { station_id, order_item_ids: ['N1'], load_id: null, due_at: hub.clock.branchNow(), reason: 'pulled' } }]);
    append(hub, [on('ItemStarted', { order_item_id: 'N1', started_at: hub.clock.branchNow(), source: 'tap' })]);
    append(hub, [on('ItemDone', { order_item_id: 'N1', done_at: hub.clock.branchNow(), source: 'tap' })]);
    append(hub, [on('ItemServed', { order_item_ids: ['N1'], source: 'tap' })]);

    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: device.deviceId });
    const res = await hub.app.inject({
      method: 'POST',
      url: '/commands/return-to-kitchen',
      headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
      payload: {
        command_id: 'cmd-return-1',
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'ReturnToKitchen',
        payload: { order_item_id: 'N1', return_order_item_id: 'R1', mode: 'remake' },
        occurred_at: hub.clock.branchNow(),
        actor_id: 'S_OWNER',
        device_id: device.deviceId,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(engine().lines.R1!.return_of).toEqual({ order_item_id: 'N1', mode: 'remake' });

    const got = details(['R1', 'N1']);
    expect(got.get('R1')).toMatchObject({
      item_name: 'Naan',
      identifier: { kind: 'table', label: 'Family 2' },
      return_of: { order_item_id: 'N1', mode: 'remake', item_name: 'Naan', identifier: { kind: 'table', label: 'Family 2' } },
      order_note: null,
      placed_by_name: 'Cashier',
    });
    expect(got.get('N1')!.return_of).toBeNull();
  });

  it('[03b §4.4] order_note and kitchen_note from a real SubmitOrder; placed_by_name = the order taker', async () => {
    await start();
    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: 'S_OWNER', deviceId: device.deviceId });
    const res = await hub.app.inject({
      method: 'POST',
      url: '/commands/submit-order',
      headers: { authorization: `Bearer ${device.token}`, 'x-session-token': session.token },
      payload: {
        command_id: 'cmd-submit-1',
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'SubmitOrder',
        payload: {
          order_id: 'O1',
          order_type: 'takeaway',
          order_note: 'birthday, bring together',
          lines: [{ order_item_id: 'L1', item_id: FX.naan, quantity: 3, kitchen_note: 'well done' }],
        },
        occurred_at: hub.clock.branchNow(),
        actor_id: 'S_OWNER',
        device_id: device.deviceId,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(details(['L1']).get('L1')).toMatchObject({
      order_id: 'O1',
      item_name: 'Naan',
      units: 3,
      kitchen_note: 'well done',
      order_note: 'birthday, bring together',
      placed_by_name: 'Owner',
    });
  });

  it('[03b §4.2] 2 statements for any batch (order lines + orders, currentTableOf); unknown ids are left out; empty → 0', async () => {
    await start();
    openSeating(hub, { table_id: FX.zoneTable, seating_id: 'SE1' });
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const lines = Array.from({ length: 10 }, (_, n) => ({ order_item_id: `L${i}_${n}`, item_id: n % 2 === 0 ? FX.piece : FX.naan }));
      appendOrder(hub, i % 3 === 0 ? { order_type: 'dine_in', seating_id: 'SE1', lines } : i % 3 === 1 ? { order_type: 'takeaway', lines } : { order_type: 'parking', lines });
      ids.push(...lines.map((l) => l.order_item_id));
    }
    const counter = statementCounter(hub.deps.db);
    const got = buildLineDetails(hub.deps.db, engine(), [...ids, 'NOPE']);
    expect(counter.count).toBe(2);
    expect(got.size).toBe(50);
    expect(got.has('NOPE')).toBe(false);
    counter.reset();
    expect(buildLineDetails(hub.deps.db, engine(), []).size).toBe(0);
    expect(counter.count).toBe(0);
  });

  it('[03b §3.1] pointOfLine: EngineLine.point_id, else the station\'s point; unknown → null; 0 statements', async () => {
    await start();
    appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'K1', item_id: FX.piece }, { order_item_id: 'K2', item_id: FX.naan }] });
    const counter = statementCounter(hub.deps.db);
    expect(pointOfLine(engine(), 'K1')).toBe('P1');
    expect(pointOfLine(engine(), 'NOPE')).toBeNull();
    // A line routed to another point (an alternate on another point, 03b #29) keeps its own point …
    const state = engine();
    const moved: EngineState = { ...state, lines: { ...state.lines, K1: { ...state.lines.K1!, point_id: 'P2' }, K2: { ...state.lines.K2!, point_id: null } } };
    expect(pointOfLine(moved, 'K1')).toBe('P2');
    // … and a line with no point of its own takes its station's point.
    expect(pointOfLine(moved, 'K2')).toBe('P1');
    expect(buildLineDetails(hub.deps.db, moved, ['K1']).get('K1')!.point_id).toBe('P2');
    expect(counter.count).toBe(2);
  });
});
