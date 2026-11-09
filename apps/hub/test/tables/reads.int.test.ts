import { performance } from 'node:perf_hooks';
import type { BranchConfig, EngineConfig } from '@pos/events';
import { aBranchConfig, aBusinessDayOpened, anEngineConfigApplied } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerEngineBootSteps } from '../../src/engine-host/boot-steps';
import { registerRestaurantBootSteps } from '../../src/sync/boot-steps';
import { startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { ENGINE_ALERT_KINDS } from '../../src/engine-host/fires-alerts-tick';
import { draftOf, fakeSubmit } from '../engine/fakes';
import { swapDirectory } from '../../src/auth/guards';
import type { StaffDirectory } from '../../src/auth/staff-directory';
import { registerSlipReaders, resetSlipReaders, slipReaders } from '../../src/engine-host/slip-readers';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { currentTableOf, holdersOfOrders, seatingOf, tableOwners, zoneOf } from '../../src/tables/reads';
import { registerTables } from '../../src/tables/index';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';

registerEngineBootSteps(() => performance.now());
registerRestaurantBootSteps();

let hub: TestHub;

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub);
});

afterEach(async () => {
  swapBranchConfig(null);
  resetSlipReaders();
  await hub.close();
});

function seat(
  seating_id: string,
  primary: string,
  holder: string,
  o: { tables?: string[]; state?: string; orders?: string[] } = {},
): void {
  const { db } = hub.deps;
  db.prepare(
    'INSERT INTO seatings (seating_id, primary_table_id, state, holder_staff_id, opened_at) VALUES (?, ?, ?, ?, 1)',
  ).run(seating_id, primary, o.state ?? 'SEATED', holder);
  for (const t of o.tables ?? [primary]) {
    db.prepare('INSERT INTO seating_tables (table_id, seating_id, joined_at) VALUES (?, ?, 1)').run(t, seating_id);
  }
  for (const order_id of o.orders ?? []) {
    db.prepare('INSERT INTO seating_orders (order_id, seating_id) VALUES (?, ?)').run(order_id, seating_id);
  }
}

describe('02a table reads (§4.2)', () => {
  it('[02a §4.2] tableOwners → Map<table_id, holder>, one statement for 40 tables', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `T${i}`);
    for (let i = 0; i < 20; i += 1) seat(`SEAT${i}`, `T${i}`, i % 2 === 0 ? 'S_A' : 'S_B');
    const counter = statementCounter(hub.deps.db);
    const owners = tableOwners(hub.deps.db, ids);
    expect(counter.count).toBe(1);
    expect(owners.size).toBe(20);
    expect(owners.get('T0')).toBe('S_A');
    expect(owners.get('T1')).toBe('S_B');
    expect(owners.has('T25')).toBe(false);
  });

  it('[02a §4.2] holdersOfOrders after move / merge / split → current holder, one statement', () => {
    // merge: T1 + T2 under one seating (holder S_A); split-off part on T3 with its own holder; moved party on T9.
    seat('SEAT1', 'T1', 'S_A', { tables: ['T1', 'T2'], orders: ['O1', 'O2'] });
    seat('SEAT2', 'T3', 'S_B', { orders: ['O3'] });
    seat('SEAT3', 'T9', 'S_C', { orders: ['O4'] });
    const counter = statementCounter(hub.deps.db);
    const holders = holdersOfOrders(hub.deps.db, ['O1', 'O2', 'O3', 'O4', 'O_NONE']);
    expect(counter.count).toBe(1);
    expect(Object.fromEntries(holders)).toEqual({ O1: 'S_A', O2: 'S_A', O3: 'S_B', O4: 'S_C' });
    // a handover of the split part moves only its orders
    hub.deps.db.prepare("UPDATE seatings SET holder_staff_id = 'S_D' WHERE seating_id = 'SEAT2'").run();
    expect(holdersOfOrders(hub.deps.db, ['O1', 'O3']).get('O3')).toBe('S_D');
    expect(holdersOfOrders(hub.deps.db, [])).toEqual(new Map());
  });

  it('[02a §4.2] currentTableOf → { seating_id, primary_table_id, table_ids }, one statement', () => {
    seat('SEAT1', 'T1', 'S_A', { tables: ['T1', 'T2'], orders: ['O1', 'O2'] });
    seat('SEAT2', 'T3', 'S_B', { orders: ['O3'] });
    const counter = statementCounter(hub.deps.db);
    const out = currentTableOf(hub.deps.db, ['O1', 'O2', 'O3', 'O_NONE']);
    expect(counter.count).toBe(1);
    expect(out.size).toBe(3);
    const one = out.get('O1')!;
    expect(one.seating_id).toBe('SEAT1');
    expect(one.primary_table_id).toBe('T1');
    expect([...one.table_ids].sort()).toEqual(['T1', 'T2']);
    expect(out.get('O2')).toEqual(one);
    expect(out.get('O3')).toEqual({ seating_id: 'SEAT2', primary_table_id: 'T3', table_ids: ['T3'] });
  });

  it('[02a §4.2] repeated ids in a batch give one entry each, still one statement', () => {
    seat('SEAT1', 'T1', 'S_A', { tables: ['T1', 'T2'], orders: ['O1'] });
    const counter = statementCounter(hub.deps.db);
    expect(currentTableOf(hub.deps.db, ['O1', 'O1']).get('O1')?.table_ids.slice().sort()).toEqual(['T1', 'T2']);
    expect(holdersOfOrders(hub.deps.db, ['O1', 'O1']).size).toBe(1);
    expect(tableOwners(hub.deps.db, ['T1', 'T1']).size).toBe(1);
    expect(counter.count).toBe(3);
  });

  it('[02a §4.2] seatingOf null for a FREE table', () => {
    seat('SEAT1', 'T1', 'S_A', { tables: ['T1', 'T2'], state: 'ORDERED' });
    const counter = statementCounter(hub.deps.db);
    expect(seatingOf(hub.deps.db, 'T7')).toBeNull();
    expect(counter.count).toBe(1);
    counter.reset();
    const found = seatingOf(hub.deps.db, 'T2')!;
    expect(counter.count).toBe(1);
    expect(found).toMatchObject({ seating_id: 'SEAT1', primary_table_id: 'T1', state: 'ORDERED', holder_staff_id: 'S_A' });
    expect([...found.table_ids].sort()).toEqual(['T1', 'T2']);
  });

  it('[02a §4.2] zoneOf 0 statements, table without zone → zone_id null', () => {
    const config = {
      floors: [
        { floor_id: 'F1', tables: [{ table_id: 'T1', zone_id: 'Z1' }, { table_id: 'T2', zone_id: null }] },
        { floor_id: 'F2', tables: [{ table_id: 'T8', zone_id: null }] },
      ],
    } as unknown as BranchConfig;
    swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: 3, snapshotSchemaVersion: 2, appliedAt: 0 });
    const withZone = { table_id: 'T1' };
    const withoutZone = { table_id: 'T2' };
    const floor = { floor_id: 'F1' };
    // SG-1: zone_order_taker_staff_id = directory.assignedOrderTaker(table_id); AD-6: the getter reads the current directory.
    const asked: string[] = [];
    const fake = (who: string | null): StaffDirectory =>
      ({ assignedOrderTaker: (id: string) => (asked.push(id), who) }) as unknown as StaffDirectory;
    swapDirectory(hub.app, fake('S_ZONE'));
    const counter = statementCounter(hub.deps.db);
    const a = zoneOf(withZone.table_id);
    expect(a).toEqual({ floor_id: floor.floor_id, zone_id: 'Z1', zone_order_taker_staff_id: 'S_ZONE' });
    expect(zoneOf(withoutZone.table_id).zone_id).toBeNull();
    expect(zoneOf('T8').floor_id).toBe('F2');
    expect(counter.count).toBe(0);
    expect(asked).toEqual([withZone.table_id, withoutZone.table_id, 'T8']);
    // a swapped directory (01b apply) is seen on the next call
    swapDirectory(hub.app, fake(null));
    expect(zoneOf(withZone.table_id).zone_order_taker_staff_id).toBeNull();
  });
});

describe('02a slip reader registration (SG-6, §11 step 1)', () => {
  it('[02a SG-6] registerTables does not replace slip readers a test registered first', () => {
    const mine = { holdersOfOrders: () => new Map<string, string>(), currentTableOf: () => new Map() };
    registerSlipReaders(mine);
    registerTables(hub.app, hub.deps);
    expect(slipReaders()?.holdersOfOrders).toBe(mine.holdersOfOrders);
    expect(slipReaders()?.currentTableOf).toBe(mine.currentTableOf);
  });

  it("[02a §11 step 1] after registerTables, slipReaders() returns 02a's pair", () => {
    resetSlipReaders();
    registerTables(hub.app, hub.deps);
    expect(slipReaders()?.holdersOfOrders).toBe(holdersOfOrders);
    expect(slipReaders()?.currentTableOf).toBe(currentTableOf);
    seat('SEAT1', 'T1', 'S_A', { tables: ['T1', 'T2'], orders: ['O1'] });
    const readers = slipReaders()!;
    expect(readers.holdersOfOrders(hub.deps.db, ['O1']).get('O1')).toBe('S_A');
    expect(readers.currentTableOf(hub.deps.db, ['O1']).get('O1')?.primary_table_id).toBe('T1');
  });

  it('[02a §11 step 1] a 03a fires-alerts pass uses the registered pair: receiver = holder, label = primary table name', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const stop = startTickLoop(hub.deps, { error: vi.fn() });
    try {
      const base = anEngineConfigApplied().payload as unknown as EngineConfig;
      const cfg = { ...base, stations: [{ ...base.stations[0]!, station_id: 'S1', name: 'S1', capacity: 8 }] };
      hub.deps.writer.run((tx) =>
        tx.append([anEngineConfigApplied({ payload: cfg as unknown as Record<string, unknown> }), aBusinessDayOpened()].map((e) => draftOf(e, hub.clock.branchNow()))),
      );
      hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
      const config = {
        ...aBranchConfig(),
        floors: [{ floor_id: 'F1', name: 'Main', sort_order: 0, zones: [], tables: [{ table_id: 'T1', name: 'Window 1', seats: 4, sort_order: 0, zone_id: null }, { table_id: 'T2', name: 'Window 2', seats: 4, sort_order: 1, zone_id: null }] }],
      };
      swapBranchConfig({ config, snapshotHash: 'h', configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
      seat('SEAT1', 'T1', 'S_CASH', { tables: ['T1', 'T2'] });
      fakeSubmit(hub.deps, { order_id: 'O1', actor_id: 'S_WAIT', order: { table_id: 'T2', table_key: 'dine_in:SEAT1' }, lines: [{ order_item_id: 'O1-L1' }] });
      hub.clock.set(hub.clock.branchNow());
      await vi.advanceTimersByTimeAsync(TICK_MS);
      const due = hub.deps.state.get().next_alert_due_at;
      expect(due).not.toBeNull();
      hub.clock.set(due! + 1_000);
      await vi.advanceTimersByTimeAsync(TICK_MS);
      const row = hub.deps.db
        .prepare("SELECT alert_id, json_extract(request_json, '$.receiver_staff_id') AS receiver, display_json FROM alerts WHERE kind = ? AND dedupe_key = 'slip:dine_in:SEAT1'")
        .get(ENGINE_ALERT_KINDS.slip) as { receiver: string; display_json: string };
      expect(row.receiver).toBe('S_CASH');
      expect((JSON.parse(row.display_json) as { table_code: string }).table_code).toBe('Window 1');
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});
