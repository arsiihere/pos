import { fileURLToPath } from 'node:url';
import type { EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter, type Writer } from '../../src/engine-host/writer';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { createProjectionRegistry, type ProjectionRegistry } from '../../src/projections/registry';
import { registerTablesProjection } from '../../src/tables/index';
import { bindTablesProjectionLog, foldState, TABLES_EVENT_TYPES } from '../../src/tables/projection';
import { freshDb } from '../helpers/db';
import { createTestHub } from '../helpers/test-hub';

// 02a §5 / T19: the one projection `tables`, over the real 0012 tables, fed real events through the hub writer.
const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const TENANT = 'tenant-1';
const BRANCH = 'branch-1';
const ALI = 'S_ALI';
const BILAL = 'S_BILAL';
const DEV = 'D_TAB1';

interface Harness {
  db: Database.Database;
  clock: ReturnType<typeof fixedClock>;
  writer: Writer;
  registry: ProjectionRegistry;
  logs: unknown[];
  /** appends each argument as its own writer transaction, clock +1 s before each */
  append(...drafts: EventDraft[]): void;
}

async function harness(cleanups: Array<() => void | Promise<void>>): Promise<Harness> {
  const fx = freshDb();
  cleanups.push(fx.cleanup);
  const clock = fixedClock(T);
  await runMigrations(fx.db, { dir: migrations, clock });
  const registry = createProjectionRegistry();
  registerTablesProjection(registry);
  const logs: unknown[] = [];
  bindTablesProjectionLog(registry, (line) => logs.push(line));
  const state = createStateHolder({});
  state.setReducer((current) => current);
  const writer = createWriter({
    db: fx.db,
    clock,
    ids: testIdGen(),
    tenantId: TENANT,
    branchId: BRANCH,
    projections: registry,
    state,
    authGeneration: createAuthGeneration(),
    publish: () => undefined,
  });
  return {
    db: fx.db,
    clock,
    writer,
    registry,
    logs,
    append(...drafts) {
      for (const d of drafts) {
        clock.advance(1_000);
        writer.run((tx) => tx.append([d]));
      }
    },
  };
}

function ev(stream_type: 'table' | 'order', stream_id: string, event_type: string, payload: Record<string, unknown>): EventDraft {
  return {
    stream_type,
    stream_id,
    event_type,
    schema_version: 1,
    payload,
    occurred_at: T,
    actor_id: ALI,
    device_id: DEV,
  } as EventDraft;
}

const opened = (table_id: string, seating_id: string, holder = ALI, party_size: number | null = 4) =>
  ev('table', table_id, 'TableOpened', { table_id, seating_id, holder_staff_id: holder, party_size });

function placed(order_id: string, o: { seating?: string; order_type?: string; table_key?: string; has_food?: boolean } = {}) {
  const order_type = o.order_type ?? 'dine_in';
  const payload: Record<string, unknown> = {
    order_id,
    order_type,
    table_id: null,
    table_key: o.table_key ?? `dine_in:${o.seating ?? 'S1'}`,
    follow_up: false,
    pickup_at_ms: null,
    order_item_ids: [`${order_id}-L1`],
    groups: [{ group_id: `${order_id}:0`, target_land_ms: T + 600_000, promise_ms: T + 900_000, order_item_ids: [`${order_id}-L1`] }],
    lines: [],
  };
  if (o.has_food !== undefined) payload.has_food = o.has_food;
  return ev('order', order_id, 'OrderPlaced', payload);
}

const linesAdded = (order_id: string) =>
  ev('order', order_id, 'OrderLinesAdded', {
    order_id,
    order_item_ids: [`${order_id}-L2`],
    groups: [{ group_id: `${order_id}:1`, target_land_ms: T + 600_000, promise_ms: T + 900_000, order_item_ids: [`${order_id}-L2`] }],
    lines: [],
  });
const cancelled = (order_id: string) => ev('order', order_id, 'OrderCancelled', { order_id });
const foodServed = (order_id: string) => ev('order', order_id, 'OrderFoodServed', { order_id });
const foodCleared = (order_id: string, food_served: boolean) => ev('order', order_id, 'OrderFoodCleared', { order_id, food_served });
const billRequested = (seating_id: string, table_id = 'T1') =>
  ev('table', table_id, 'BillRequested', { seating_id, table_id, by_staff_id: ALI });
const billClosed = (seating_id: string, table_id = 'T1') => ev('table', table_id, 'BillClosed', { seating_id });
const cleaned = (seating_id: string, table_ids: string[], reason: 'cleaned' | 'left_without_order' = 'cleaned') =>
  ev('table', table_ids[0]!, 'TableCleaned', { seating_id, table_ids, reason, by_staff_id: ALI });

function seating(db: Database.Database, id: string): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM seatings WHERE seating_id = ?').get(id) as Record<string, unknown> | undefined;
}
function stateOf(db: Database.Database, id: string): unknown {
  return seating(db, id)?.state;
}
function tablesOf(db: Database.Database, id: string): Array<{ table_id: string; joined_at: number }> {
  return db.prepare('SELECT table_id, joined_at FROM seating_tables WHERE seating_id = ? ORDER BY table_id').all(id) as Array<{
    table_id: string;
    joined_at: number;
  }>;
}
function order(db: Database.Database, id: string): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM seating_orders WHERE order_id = ?').get(id) as Record<string, unknown> | undefined;
}
function dump(db: Database.Database): Record<string, unknown[]> {
  return {
    seatings: db.prepare('SELECT * FROM seatings ORDER BY seating_id').all(),
    seating_tables: db.prepare('SELECT * FROM seating_tables ORDER BY table_id').all(),
    seating_orders: db.prepare('SELECT * FROM seating_orders ORDER BY order_id').all(),
    table_locks: db.prepare('SELECT * FROM table_locks ORDER BY table_id').all(),
  };
}

describe('02a tables projection', () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[02a §5] eventTypes = the ten §6.19 types + the nine 02b / 05 folds; not ItemServed (AD-4)', () => {
    expect([...TABLES_EVENT_TYPES].sort()).toEqual(
      [
        'TableOpened',
        'TableLocked',
        'TableLockTouched',
        'TableLockReleased',
        'TableHolderChanged',
        'TableMoved',
        'TablesMerged',
        'SeatingSplit',
        'BillRequested',
        'TableCleaned',
        'OrderPlaced',
        'OrderLinesAdded',
        'ItemRemoved',
        'OrderCancelled',
        'OrderFoodServed',
        'OrderFoodCleared',
        'LineWeightSet',
        'LineComped',
        'BillClosed',
      ].sort(),
    );
    expect(TABLES_EVENT_TYPES).not.toContain('ItemServed');
  });

  it('[02a §3.1] foldState: NEEDS_CLEANING sticky, then SEATED (no live order) before the bill, then BILL_REQUESTED, then P-1d ORDERED / FOOD_ON_TABLE', () => {
    const base = { bill_closed: 0 as const, bill_requested_at: null, live_orders: 1, live_food_orders: 1, unserved_food_orders: 0 };
    expect(foldState({ ...base, bill_closed: 1, live_orders: 0, live_food_orders: 0 })).toBe('NEEDS_CLEANING');
    expect(foldState({ ...base, bill_closed: 1, bill_requested_at: T })).toBe('NEEDS_CLEANING');
    expect(foldState({ ...base, live_orders: 0, live_food_orders: 0, bill_requested_at: T })).toBe('SEATED');
    expect(foldState({ ...base, bill_requested_at: T })).toBe('BILL_REQUESTED');
    expect(foldState({ ...base, unserved_food_orders: 1 })).toBe('ORDERED');
    expect(foldState({ ...base, live_food_orders: 0 })).toBe('ORDERED');
    expect(foldState(base)).toBe('FOOD_ON_TABLE');
  });

  it('[02a §3.1] TableOpened → seating SEATED (times = recorded_at) and its seating_tables row; holder change folds', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'));
    const at = h.clock.branchNow();
    expect(seating(h.db, 'S1')).toEqual({
      seating_id: 'S1',
      primary_table_id: 'T1',
      state: 'SEATED',
      holder_staff_id: ALI,
      party_size: 4,
      opened_at: at,
      bill_requested_at: null,
      bill_closed: 0,
      closed_at: null,
      close_reason: null,
    });
    expect(tablesOf(h.db, 'S1')).toEqual([{ table_id: 'T1', joined_at: at }]);
    h.append(
      ev('table', 'T1', 'TableHolderChanged', {
        table_id: 'T1',
        seating_id: 'S1',
        from_staff_id: ALI,
        to_staff_id: BILAL,
        reason: 'take_over',
        by_staff_id: BILAL,
      }),
    );
    expect(seating(h.db, 'S1')?.holder_staff_id).toBe(BILAL);
  });

  it('[02a §3.1] lock-only events change no seating rows; they write only the lock row (task 5, lock-fold.int.test.ts)', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'));
    const before = dump(h.db);
    h.append(
      ev('table', 'T1', 'TableLocked', { table_id: 'T1', seating_id: 'S1', staff_id: ALI }),
      ev('table', 'T1', 'TableLockTouched', { table_id: 'T1', seating_id: 'S1' }),
    );
    expect(dump(h.db)).toEqual({ ...before, table_locks: [expect.objectContaining({ table_id: 'T1', seating_id: 'S1', staff_id: ALI })] });
    h.append(ev('table', 'T1', 'TableLockReleased', { table_id: 'T1', seating_id: 'S1', staff_id: ALI, reason: 'released' }));
    expect(dump(h.db)).toEqual(before);
  });

  it('[02a #31 fold] new OrderPlaced and OrderLinesAdded after BillRequested → ORDERED, bill_requested_at cleared; OrderLinesAdded sets served_any = 0', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), placed('O1'));
    expect(stateOf(h.db, 'S1')).toBe('ORDERED');
    h.append(billRequested('S1'));
    expect(seating(h.db, 'S1')).toMatchObject({ state: 'BILL_REQUESTED', bill_requested_at: h.clock.branchNow() });
    h.append(placed('O2'));
    expect(seating(h.db, 'S1')).toMatchObject({ state: 'ORDERED', bill_requested_at: null });

    h.append(foodServed('O1'), foodServed('O2'));
    expect(stateOf(h.db, 'S1')).toBe('FOOD_ON_TABLE');
    h.append(billRequested('S1'));
    expect(stateOf(h.db, 'S1')).toBe('BILL_REQUESTED');
    h.append(linesAdded('O1'));
    expect(seating(h.db, 'S1')).toMatchObject({ state: 'ORDERED', bill_requested_at: null });
    expect(order(h.db, 'O1')).toMatchObject({ served_any: 0 });
    expect(order(h.db, 'O2')).toMatchObject({ served_any: 1 });
  });

  it('[02a #32 fold] BillClosed { seating_id } → NEEDS_CLEANING, sticky against later order events and bill requests', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), placed('O1'), foodServed('O1'), billRequested('S1'), billClosed('S1'));
    expect(seating(h.db, 'S1')).toMatchObject({ state: 'NEEDS_CLEANING', bill_closed: 1 });
    h.append(linesAdded('O1'), billRequested('S1'), cancelled('O1'));
    expect(stateOf(h.db, 'S1')).toBe('NEEDS_CLEANING');
  });

  it('[02a #33 fold] every order cancelled → SEATED; bill requested, then every order cancelled → SEATED with bill_requested_at cleared', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), placed('O1'), placed('O2'), cancelled('O1'));
    expect(stateOf(h.db, 'S1')).toBe('ORDERED');
    h.append(cancelled('O2'));
    expect(stateOf(h.db, 'S1')).toBe('SEATED');
    expect(order(h.db, 'O1')).toMatchObject({ cancelled: 1 });

    h.append(opened('T2', 'S2'), placed('O3', { seating: 'S2' }), billRequested('S2', 'T2'));
    expect(stateOf(h.db, 'S2')).toBe('BILL_REQUESTED');
    h.append(cancelled('O3'));
    expect(seating(h.db, 'S2')).toMatchObject({ state: 'SEATED', bill_requested_at: null });
  });

  it('[02a #57] P-1d: karahi order then OrderFoodServed → FOOD_ON_TABLE; water-only (has_food = 0) → ORDERED, never FOOD_ON_TABLE; ItemServed alone does not set served_any', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), placed('O1'));
    expect(order(h.db, 'O1')).toMatchObject({ seating_id: 'S1', has_food: 1, served_any: 0, cancelled: 0 });
    h.append(ev('order', 'O1', 'ItemServed', { order_item_ids: ['O1-L1'], source: 'tap' }));
    expect(order(h.db, 'O1')).toMatchObject({ served_any: 0 });
    expect(stateOf(h.db, 'S1')).toBe('ORDERED');
    h.append(foodServed('O1'));
    expect(order(h.db, 'O1')).toMatchObject({ served_any: 1, has_food: 1 });
    expect(stateOf(h.db, 'S1')).toBe('FOOD_ON_TABLE');

    h.append(opened('T2', 'S2'), placed('W1', { seating: 'S2', has_food: false }));
    expect(order(h.db, 'W1')).toMatchObject({ has_food: 0 });
    expect(stateOf(h.db, 'S2')).toBe('ORDERED');
    h.append(ev('order', 'W1', 'ItemServed', { order_item_ids: ['W1-L1'], source: 'tap' }));
    expect(stateOf(h.db, 'S2')).toBe('ORDERED');
  });

  it('[02a #58] P-1d: OrderFoodCleared { food_served: true } → served_any = 1; { false } → has_food = 0 and the table leaves ORDERED when no other unserved food order; replay identical', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), placed('O1'), foodCleared('O1', true));
    expect(order(h.db, 'O1')).toMatchObject({ served_any: 1, has_food: 1 });
    expect(stateOf(h.db, 'S1')).toBe('FOOD_ON_TABLE');
    h.append(placed('O2'));
    expect(stateOf(h.db, 'S1')).toBe('ORDERED');
    h.append(foodCleared('O2', false));
    expect(order(h.db, 'O2')).toMatchObject({ served_any: 0, has_food: 0 });
    expect(stateOf(h.db, 'S1')).toBe('FOOD_ON_TABLE');
    const live = dump(h.db);
    h.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'tables'`).run();
    const fresh = createProjectionRegistry();
    registerTablesProjection(fresh);
    fresh.catchUp(h.db, BRANCH);
    expect(dump(h.db)).toEqual(live);
  });

  it('[02a §3.1] FOOD_ON_TABLE looks only at live food orders: a cancelled unserved food order does not hold the table in ORDERED', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), placed('O1'), placed('O2'), foodServed('O1'));
    expect(stateOf(h.db, 'S1')).toBe('ORDERED');
    h.append(cancelled('O2'));
    expect(stateOf(h.db, 'S1')).toBe('FOOD_ON_TABLE');
    h.append(placed('W1', { has_food: false }));
    expect(stateOf(h.db, 'S1')).toBe('FOOD_ON_TABLE');
  });

  it('[02a #55] takeaway / delivery OrderPlaced leaves every row unchanged; dine_in with table_key dine_in:S joins S (T21); a key naming no open seating is ignored and logged once, live only', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'));
    const before = dump(h.db);
    h.append(placed('TA1', { order_type: 'takeaway', table_key: 'takeaway:TA1' }), placed('DL1', { order_type: 'delivery', table_key: 'delivery:DL1' }));
    expect(dump(h.db)).toEqual(before);
    expect(h.logs).toEqual([]);

    h.append(placed('O1', { table_key: 'dine_in:S1' }));
    expect(order(h.db, 'O1')).toMatchObject({ seating_id: 'S1' });

    h.append(cleaned('S1', ['T1'], 'left_without_order'));
    const afterClean = dump(h.db);
    h.append(placed('O2', { table_key: 'dine_in:S1' }), placed('O3', { table_key: 'dine_in:NOPE' }));
    expect(dump(h.db)).toEqual(afterClean);
    expect(h.logs).toEqual([
      { order_id: 'O2', table_key: 'dine_in:S1' },
      { order_id: 'O3', table_key: 'dine_in:NOPE' },
    ]);

    h.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'tables'`).run();
    const fresh = createProjectionRegistry();
    registerTablesProjection(fresh);
    const replayLogs: unknown[] = [];
    bindTablesProjectionLog(fresh, (line) => replayLogs.push(line));
    fresh.catchUp(h.db, BRANCH);
    expect(replayLogs).toEqual([]);
    expect(h.logs).toHaveLength(2);
    expect(dump(h.db)).toEqual(afterClean);
  });

  it('[02a §3.1] TablesMerged join: a FREE table joins the into seating; absorb: orders and tables move to S, S2 CLOSED merged, bill of S cleared when S2 brings an order', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), placed('O1'), foodServed('O1'), billRequested('S1'));
    h.append(
      ev('table', 'T1', 'TablesMerged', {
        into_seating_id: 'S1',
        into_table_id: 'T1',
        table_ids: ['T4'],
        absorbed_seating_id: null,
        order_ids: [],
        by_staff_id: ALI,
      }),
    );
    const joinedAt = h.clock.branchNow();
    expect(tablesOf(h.db, 'S1').map((r) => r.table_id)).toEqual(['T1', 'T4']);
    expect(tablesOf(h.db, 'S1').find((r) => r.table_id === 'T4')?.joined_at).toBe(joinedAt);
    expect(seating(h.db, 'S1')).toMatchObject({ state: 'BILL_REQUESTED' });

    h.append(opened('T2', 'S2'), placed('O2', { seating: 'S2' }));
    h.append(
      ev('table', 'T1', 'TablesMerged', {
        into_seating_id: 'S1',
        into_table_id: 'T1',
        table_ids: ['T2'],
        absorbed_seating_id: 'S2',
        order_ids: ['O2'],
        by_staff_id: ALI,
      }),
    );
    const mergedAt = h.clock.branchNow();
    expect(tablesOf(h.db, 'S1').map((r) => r.table_id)).toEqual(['T1', 'T2', 'T4']);
    expect(tablesOf(h.db, 'S2')).toEqual([]);
    expect(order(h.db, 'O2')).toMatchObject({ seating_id: 'S1' });
    expect(seating(h.db, 'S2')).toMatchObject({ state: 'CLOSED', closed_at: mergedAt, close_reason: 'merged' });
    expect(seating(h.db, 'S1')).toMatchObject({ state: 'ORDERED', bill_requested_at: null, primary_table_id: 'T1', holder_staff_id: ALI });

    // CLOSED is never re-folded: a later event on the absorbed seating's old order id finds S1, not S2
    h.append(foodServed('O2'));
    expect(stateOf(h.db, 'S2')).toBe('CLOSED');
    expect(stateOf(h.db, 'S1')).toBe('FOOD_ON_TABLE');
  });

  it('[02a §3.1] TablesMerged absorbing a seating with no order keeps the bill request of S', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), placed('O1'), billRequested('S1'), opened('T2', 'S2'));
    h.append(
      ev('table', 'T1', 'TablesMerged', {
        into_seating_id: 'S1',
        into_table_id: 'T1',
        table_ids: ['T2'],
        absorbed_seating_id: 'S2',
        order_ids: [],
        by_staff_id: ALI,
      }),
    );
    expect(seating(h.db, 'S1')).toMatchObject({ state: 'BILL_REQUESTED' });
    expect(seating(h.db, 'S2')).toMatchObject({ state: 'CLOSED', close_reason: 'merged' });
  });

  it('[02a §3.1] SeatingSplit with new_seating_id: new seating on to_table_id, same holder, orders re-pointed, both folded; detach frees a joined table', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1', BILAL), placed('O1'), placed('O2'), foodServed('O1'));
    h.append(
      ev('table', 'T1', 'TablesMerged', {
        into_seating_id: 'S1',
        into_table_id: 'T1',
        table_ids: ['T4', 'T5'],
        absorbed_seating_id: null,
        order_ids: [],
        by_staff_id: ALI,
      }),
    );
    expect(stateOf(h.db, 'S1')).toBe('ORDERED');
    // split O2 (unserved) to the joined T4
    h.append(
      ev('table', 'T1', 'SeatingSplit', { from_seating_id: 'S1', new_seating_id: 'S3', to_table_id: 'T4', order_ids: ['O2'], by_staff_id: ALI }),
    );
    const splitAt = h.clock.branchNow();
    expect(seating(h.db, 'S3')).toEqual({
      seating_id: 'S3',
      primary_table_id: 'T4',
      state: 'ORDERED',
      holder_staff_id: BILAL,
      party_size: null,
      opened_at: splitAt,
      bill_requested_at: null,
      bill_closed: 0,
      closed_at: null,
      close_reason: null,
    });
    expect(tablesOf(h.db, 'S3').map((r) => r.table_id)).toEqual(['T4']);
    expect(tablesOf(h.db, 'S1').map((r) => r.table_id)).toEqual(['T1', 'T5']);
    expect(order(h.db, 'O2')).toMatchObject({ seating_id: 'S3' });
    expect(stateOf(h.db, 'S1')).toBe('FOOD_ON_TABLE');

    // split O1 to a FREE table T9
    h.append(placed('O4'));
    h.append(
      ev('table', 'T1', 'SeatingSplit', { from_seating_id: 'S1', new_seating_id: 'S4', to_table_id: 'T9', order_ids: ['O1'], by_staff_id: ALI }),
    );
    expect(tablesOf(h.db, 'S4').map((r) => r.table_id)).toEqual(['T9']);
    expect(seating(h.db, 'S4')).toMatchObject({ primary_table_id: 'T9', state: 'FOOD_ON_TABLE', holder_staff_id: BILAL });
    expect(stateOf(h.db, 'S1')).toBe('ORDERED');

    // detach T5
    h.append(
      ev('table', 'T1', 'SeatingSplit', { from_seating_id: 'S1', new_seating_id: null, to_table_id: 'T5', order_ids: [], by_staff_id: ALI }),
    );
    expect(tablesOf(h.db, 'S1').map((r) => r.table_id)).toEqual(['T1']);
    expect(h.db.prepare(`SELECT COUNT(*) AS n FROM seating_tables WHERE table_id = 'T5'`).get()).toEqual({ n: 0 });
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM seatings').get()).toEqual({ n: 3 });
  });

  it('[02a §3.12] SeatingSplit from a seating that is not open writes nothing; split and absorb re-point only the from / absorbed seating\'s orders', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), placed('O1'), billClosed('S1'), cleaned('S1', ['T1']));
    h.append(opened('T2', 'S2'), placed('O2', { seating: 'S2' }));
    const before = dump(h.db);
    h.append(
      ev('table', 'T1', 'SeatingSplit', { from_seating_id: 'S1', new_seating_id: 'S5', to_table_id: 'T6', order_ids: ['O1'], by_staff_id: ALI }),
      ev('table', 'T1', 'SeatingSplit', { from_seating_id: 'NOPE', new_seating_id: 'S6', to_table_id: 'T7', order_ids: ['O2'], by_staff_id: ALI }),
      ev('table', 'T1', 'SeatingSplit', { from_seating_id: 'S1', new_seating_id: null, to_table_id: 'T1', order_ids: [], by_staff_id: ALI }),
    );
    expect(dump(h.db)).toEqual(before);

    // a split of S2 naming S3's order O3 does not take it
    h.append(opened('T3', 'S3'), placed('O3', { seating: 'S3' }), placed('O4', { seating: 'S2' }));
    h.append(
      ev('table', 'T2', 'SeatingSplit', { from_seating_id: 'S2', new_seating_id: 'S7', to_table_id: 'T8', order_ids: ['O4', 'O3'], by_staff_id: ALI }),
    );
    expect(order(h.db, 'O4')).toMatchObject({ seating_id: 'S7' });
    expect(order(h.db, 'O3')).toMatchObject({ seating_id: 'S3' });

    // an absorb of S7 into S2 naming S3's order O3 does not take it
    h.append(
      ev('table', 'T2', 'TablesMerged', {
        into_seating_id: 'S2',
        into_table_id: 'T2',
        table_ids: ['T8'],
        absorbed_seating_id: 'S7',
        order_ids: ['O4', 'O3'],
        by_staff_id: ALI,
      }),
    );
    expect(order(h.db, 'O4')).toMatchObject({ seating_id: 'S2' });
    expect(order(h.db, 'O3')).toMatchObject({ seating_id: 'S3' });
    expect(stateOf(h.db, 'S3')).toBe('ORDERED');
  });

  it('[02a §3.1] TableMoved re-keys primary_table_id and the seating_tables row (joined_at kept); orders follow', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), placed('O1'));
    const joinedAt = h.clock.branchNow() - 1_000;
    h.append(ev('table', 'T1', 'TableMoved', { seating_id: 'S1', from_table_id: 'T1', to_table_id: 'T7', by_staff_id: ALI }));
    expect(seating(h.db, 'S1')).toMatchObject({ primary_table_id: 'T7', state: 'ORDERED' });
    expect(tablesOf(h.db, 'S1')).toEqual([{ table_id: 'T7', joined_at: joinedAt }]);
    expect(order(h.db, 'O1')).toMatchObject({ seating_id: 'S1' });
  });

  it('[02a §3.1] TableCleaned → CLOSED (closed_at, reason), tables freed, seating_orders kept; the table opens again as a new seating', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), placed('O1'), billClosed('S1'));
    h.append(
      ev('table', 'T1', 'TablesMerged', {
        into_seating_id: 'S1',
        into_table_id: 'T1',
        table_ids: ['T4'],
        absorbed_seating_id: null,
        order_ids: [],
        by_staff_id: ALI,
      }),
    );
    h.append(cleaned('S1', ['T1', 'T4']));
    expect(seating(h.db, 'S1')).toMatchObject({ state: 'CLOSED', closed_at: h.clock.branchNow(), close_reason: 'cleaned' });
    expect(tablesOf(h.db, 'S1')).toEqual([]);
    expect(order(h.db, 'O1')).toMatchObject({ seating_id: 'S1' });
    h.append(opened('T1', 'S9'));
    expect(stateOf(h.db, 'S9')).toBe('SEATED');
    expect(stateOf(h.db, 'S1')).toBe('CLOSED');
  });

  it('[02a #38] reset + replay → identical seatings, seating_tables, seating_orders and table_locks', async () => {
    const h = await harness(cleanups);
    h.append(
      opened('T1', 'S1'),
      ev('table', 'T1', 'TableLocked', { table_id: 'T1', seating_id: 'S1', staff_id: ALI }),
      placed('O1'),
      placed('O2'),
      foodServed('O1'),
      ev('table', 'T1', 'TableLockTouched', { table_id: 'T1', seating_id: 'S1' }),
      opened('T2', 'S2', BILAL, 2),
      placed('O3', { seating: 'S2', has_food: false }),
      ev('table', 'T1', 'TablesMerged', {
        into_seating_id: 'S1',
        into_table_id: 'T1',
        table_ids: ['T2'],
        absorbed_seating_id: 'S2',
        order_ids: ['O3'],
        by_staff_id: ALI,
      }),
      ev('table', 'T1', 'SeatingSplit', { from_seating_id: 'S1', new_seating_id: 'S3', to_table_id: 'T2', order_ids: ['O2'], by_staff_id: ALI }),
      ev('table', 'T2', 'TableLocked', { table_id: 'T2', seating_id: 'S3', staff_id: ALI }),
      ev('table', 'T2', 'TableMoved', { seating_id: 'S3', from_table_id: 'T2', to_table_id: 'T8', by_staff_id: ALI }),
      billRequested('S1'),
      linesAdded('O1'),
      foodCleared('O1', true),
      billRequested('S1'),
      ev('table', 'T1', 'TableLockReleased', { table_id: 'T1', seating_id: 'S1', staff_id: ALI, reason: 'released' }),
      billClosed('S1'),
      cleaned('S1', ['T1']),
      opened('T1', 'S4'),
      ev('table', 'T1', 'TableLocked', { table_id: 'T1', seating_id: 'S4', staff_id: ALI }),
      placed('O4', { seating: 'S4' }),
      cancelled('O4'),
    );
    const live = dump(h.db);
    expect(live.seatings).toHaveLength(4);
    // the lock of S3 re-keyed to T8; S4's lock refreshed by O4; S1's released
    expect(live.table_locks).toEqual([
      expect.objectContaining({ table_id: 'T1', seating_id: 'S4', last_activity_at: h.clock.branchNow() - 1_000 }),
      expect.objectContaining({ table_id: 'T8', seating_id: 'S3' }),
    ]);
    // reset must clear rows it does not rebuild from scratch
    h.db.prepare(`INSERT INTO seatings (seating_id, primary_table_id, state, holder_staff_id, opened_at) VALUES ('JUNK', 'TX', 'SEATED', 'X', 0)`).run();
    h.db
      .prepare(`INSERT INTO table_locks (table_id, seating_id, staff_id, device_id, locked_at, last_activity_at) VALUES ('TX', 'JUNK', 'X', 'D', 0, 0)`)
      .run();
    h.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'tables'`).run();
    const fresh = createProjectionRegistry();
    registerTablesProjection(fresh);
    const replayed = fresh.catchUp(h.db, BRANCH).replayed.tables;
    expect(replayed).toBe(23);
    expect(dump(h.db)).toEqual(live);
  });

  it('[02a #55] on a test hub the unknown-seating line reaches the server log once (live)', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.deps.writer.run((tx) => tx.append([placed('O9', { table_key: 'dine_in:NOPE' })]));
    const lines = hub
      .logs()
      .split('\n')
      .filter((l) => l.includes('dine_in:NOPE'));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 40, order_id: 'O9', table_key: 'dine_in:NOPE' });
  });

  it('[02a §5 SG-5] wiring: the test hub (as boot createDeps) registers the tables projection', async () => {
    const hub = await createTestHub();
    cleanups.push(() => hub.close());
    hub.deps.writer.run((tx) => tx.append([opened('T1', 'S1')]));
    expect(stateOf(hub.deps.db, 'S1')).toBe('SEATED');
  });
});
