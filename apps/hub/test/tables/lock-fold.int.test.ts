import { fileURLToPath } from 'node:url';
import type { EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter } from '../../src/engine-host/writer';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { createProjectionRegistry } from '../../src/projections/registry';
import type { LockRow } from '../../src/tables/contracts';
import { registerTablesProjection } from '../../src/tables/index';
import { freshDb } from '../helpers/db';

// 02a §3.3 / T7 / T19: the lock part of the one projection `tables` — table_locks folds and the activity refresh,
// over the real 0012 tables, fed real events through the hub writer.
const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const TENANT = 'tenant-1';
const BRANCH = 'branch-1';
const ALI = 'S_ALI';
const BILAL = 'S_BILAL';
const DEV = 'D_TAB1';
const DEV2 = 'D_TAB2';

interface By {
  actor?: string;
  device?: string;
}

interface Harness {
  db: Database.Database;
  /** the recorded_at of the last appended event */
  now(): number;
  /** appends each argument as its own writer transaction, clock +1 s before each */
  append(...drafts: EventDraft[]): void;
  /** deletes the tables checkpoint and replays on a fresh registry (reset + catch-up) */
  replay(): void;
}

async function harness(cleanups: Array<() => void>): Promise<Harness> {
  const fx = freshDb();
  cleanups.push(fx.cleanup);
  const clock = fixedClock(T);
  await runMigrations(fx.db, { dir: migrations, clock });
  const registry = createProjectionRegistry();
  registerTablesProjection(registry);
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
    now: () => clock.branchNow(),
    append(...drafts) {
      for (const d of drafts) {
        clock.advance(1_000);
        writer.run((tx) => tx.append([d]));
      }
    },
    replay() {
      fx.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'tables'`).run();
      const fresh = createProjectionRegistry();
      registerTablesProjection(fresh);
      fresh.catchUp(fx.db, BRANCH);
    },
  };
}

function ev(stream_type: 'table' | 'order', stream_id: string, event_type: string, payload: Record<string, unknown>, by: By = {}): EventDraft {
  return {
    stream_type,
    stream_id,
    event_type,
    schema_version: 1,
    payload,
    occurred_at: T,
    actor_id: by.actor ?? ALI,
    device_id: by.device ?? DEV,
  } as EventDraft;
}

const opened = (table_id: string, seating_id: string, holder = ALI) =>
  ev('table', table_id, 'TableOpened', { table_id, seating_id, holder_staff_id: holder, party_size: 2 });
const locked = (table_id: string, seating_id: string, by: By = {}, replaced_device_id?: string) =>
  ev(
    'table',
    table_id,
    'TableLocked',
    { table_id, seating_id, staff_id: by.actor ?? ALI, ...(replaced_device_id === undefined ? {} : { replaced_device_id }) },
    by,
  );
const touched = (table_id: string, seating_id: string, by: By = {}) => ev('table', table_id, 'TableLockTouched', { table_id, seating_id }, by);
const released = (table_id: string, seating_id: string, by: By = {}) =>
  ev('table', table_id, 'TableLockReleased', { table_id, seating_id, staff_id: by.actor ?? ALI, reason: 'released' }, by);

function placed(order_id: string, seating_id: string, by: By = {}) {
  return ev(
    'order',
    order_id,
    'OrderPlaced',
    {
      order_id,
      order_type: 'dine_in',
      table_id: null,
      table_key: `dine_in:${seating_id}`,
      follow_up: false,
      pickup_at_ms: null,
      order_item_ids: [`${order_id}-L1`],
      groups: [{ group_id: `${order_id}:0`, target_land_ms: T + 600_000, promise_ms: T + 900_000, order_item_ids: [`${order_id}-L1`] }],
      lines: [],
    },
    by,
  );
}
const linesAdded = (order_id: string, by: By = {}) =>
  ev(
    'order',
    order_id,
    'OrderLinesAdded',
    {
      order_id,
      order_item_ids: [`${order_id}-L2`],
      groups: [{ group_id: `${order_id}:1`, target_land_ms: T + 600_000, promise_ms: T + 900_000, order_item_ids: [`${order_id}-L2`] }],
      lines: [],
    },
    by,
  );
// 02b §6.19: LineWeightSet / LineComped / ItemRemoved carry no order_id — the order is the envelope stream_id.
const weightSet = (order_id: string, by: By = {}) =>
  ev('order', order_id, 'LineWeightSet', { order_item_id: `${order_id}-L1`, quantity: 750, line_total_minor: 150_000 }, by);
const comped = (order_id: string, by: By = {}) =>
  ev(
    'order',
    order_id,
    'LineComped',
    {
      order_item_id: `${order_id}-L1`,
      units: 1,
      value_minor: 50_000,
      reason_code: 'quality',
      note: null,
      requester_staff_id: by.actor ?? ALI,
      alert_id: null,
      approver_staff_id: null,
    },
    by,
  );
const itemRemoved = (order_id: string, by: By = {}) => ev('order', order_id, 'ItemRemoved', { order_item_id: `${order_id}-L1` }, by);
const split = (from: string, to_table_id: string, newSeating: string | null, order_ids: string[], by: By = {}) =>
  ev('table', 'T1', 'SeatingSplit', { from_seating_id: from, new_seating_id: newSeating, to_table_id, order_ids, by_staff_id: by.actor ?? ALI }, by);

function lock(db: Database.Database, table_id: string): LockRow | undefined {
  return db.prepare('SELECT * FROM table_locks WHERE table_id = ?').get(table_id) as LockRow | undefined;
}
function locks(db: Database.Database): LockRow[] {
  return db.prepare('SELECT * FROM table_locks ORDER BY table_id').all() as LockRow[];
}
function stateRows(db: Database.Database): Record<string, unknown[]> {
  return {
    seatings: db.prepare('SELECT * FROM seatings ORDER BY seating_id').all(),
    seating_tables: db.prepare('SELECT * FROM seating_tables ORDER BY table_id').all(),
    seating_orders: db.prepare('SELECT * FROM seating_orders ORDER BY order_id').all(),
  };
}

describe('02a tables projection — lock part', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[02a §3.3] TableLocked upserts by table_id (device = envelope, times = recorded_at, last_touch_at NULL); TableLockTouched sets last_touch_at; TableLockReleased deletes', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), locked('T1', 'S1'));
    const lockedAt = h.now();
    expect(lock(h.db, 'T1')).toEqual({
      table_id: 'T1',
      seating_id: 'S1',
      staff_id: ALI,
      device_id: DEV,
      locked_at: lockedAt,
      last_activity_at: lockedAt,
      last_touch_at: null,
    });

    h.append(touched('T1', 'S1'));
    const touchedAt = h.now();
    expect(lock(h.db, 'T1')).toMatchObject({ locked_at: lockedAt, last_touch_at: touchedAt, last_activity_at: touchedAt });

    // T15: the same staff on another device takes the lock over — a fresh row
    h.append(locked('T1', 'S1', { device: DEV2 }, DEV));
    const movedAt = h.now();
    expect(lock(h.db, 'T1')).toEqual({
      table_id: 'T1',
      seating_id: 'S1',
      staff_id: ALI,
      device_id: DEV2,
      locked_at: movedAt,
      last_activity_at: movedAt,
      last_touch_at: null,
    });
    expect(locks(h.db)).toHaveLength(1);

    // a touch from a device that is not the lock's sets last_touch_at but is no activity
    h.append(touched('T1', 'S1'));
    expect(lock(h.db, 'T1')).toMatchObject({ last_touch_at: h.now(), last_activity_at: movedAt });

    h.append(released('T1', 'S1', { device: DEV2 }));
    expect(locks(h.db)).toEqual([]);
  });

  it('[02a §3.3] TableMoved re-keys the lock; TableCleaned deletes it; TablesMerged deletes the absorbed seating\'s lock; SeatingSplit keeps the lock on the from seating', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), locked('T1', 'S1'), placed('O1', 'S1'), placed('O2', 'S1'));
    h.append(ev('table', 'T1', 'TableMoved', { seating_id: 'S1', from_table_id: 'T1', to_table_id: 'T7', by_staff_id: ALI }));
    expect(lock(h.db, 'T1')).toBeUndefined();
    expect(lock(h.db, 'T7')).toMatchObject({ seating_id: 'S1', staff_id: ALI, device_id: DEV, last_activity_at: h.now() });

    h.append(opened('T2', 'S2', BILAL), locked('T2', 'S2', { actor: BILAL, device: DEV2 }), placed('O3', 'S2', { actor: BILAL, device: DEV2 }));
    h.append(
      ev('table', 'T7', 'TablesMerged', {
        into_seating_id: 'S1',
        into_table_id: 'T7',
        table_ids: ['T2'],
        absorbed_seating_id: 'S2',
        order_ids: ['O3'],
        by_staff_id: ALI,
      }),
    );
    const mergedAt = h.now();
    expect(lock(h.db, 'T2')).toBeUndefined();
    expect(locks(h.db)).toEqual([expect.objectContaining({ table_id: 'T7', seating_id: 'S1', last_activity_at: mergedAt })]);

    h.append(split('S1', 'T2', 'S3', ['O2']));
    expect(locks(h.db)).toEqual([expect.objectContaining({ table_id: 'T7', seating_id: 'S1', last_activity_at: h.now() })]);
    expect(h.db.prepare(`SELECT COUNT(*) AS n FROM table_locks WHERE seating_id = 'S3'`).get()).toEqual({ n: 0 });

    h.append(locked('T2', 'S3'));
    h.append(ev('table', 'T7', 'TableCleaned', { seating_id: 'S1', table_ids: ['T7'], reason: 'cleaned', by_staff_id: ALI }));
    expect(locks(h.db)).toEqual([expect.objectContaining({ table_id: 'T2', seating_id: 'S3' })]);
  });

  it('[02a #9] a 02b OrderPlaced by the lock\'s (staff, device) refreshes last_activity_at; by another device or staff it does not; reset + replay → identical lock row (the tick\'s only input)', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), locked('T1', 'S1'));
    const lockedAt = h.now();
    h.append(placed('O1', 'S1', { device: DEV2 }), placed('O2', 'S1', { actor: BILAL }));
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: lockedAt });
    // an order of another seating by the holder is not this lock's activity
    h.append(opened('T2', 'S2'), placed('O3', 'S2'));
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: lockedAt });

    h.append(placed('O4', 'S1'));
    const refreshedAt = h.now();
    expect(lock(h.db, 'T1')).toMatchObject({ locked_at: lockedAt, last_activity_at: refreshedAt });
    h.append(placed('O5', 'S1', { device: DEV2 }));
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: refreshedAt });

    const live = locks(h.db);
    h.db.prepare(`UPDATE table_locks SET last_activity_at = 0`).run();
    h.replay();
    expect(locks(h.db)).toEqual(live);
  });

  it('[02a #9b] refresh by OrderLinesAdded on O, then O split to S3: later activity on O is S3\'s, not S1\'s; reset + replay → identical lock row', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), locked('T1', 'S1'), placed('O1', 'S1'), placed('O2', 'S1'));
    h.append(linesAdded('O1'));
    const addedAt = h.now();
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: addedAt });

    h.append(split('S1', 'T9', 'S3', ['O1'], { device: DEV2 }));
    expect(lock(h.db, 'T1')).toMatchObject({ seating_id: 'S1', last_activity_at: addedAt });
    // O is S3's now: activity on it by S1's lock holder does not refresh S1's lock
    h.append(linesAdded('O1'), weightSet('O1'));
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: addedAt });
    // S3 gets its own lock; activity on O refreshes it
    h.append(locked('T9', 'S3', { actor: BILAL }), linesAdded('O1', { actor: BILAL }));
    expect(lock(h.db, 'T9')).toMatchObject({ seating_id: 'S3', last_activity_at: h.now() });
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: addedAt });

    const live = locks(h.db);
    expect(live).toHaveLength(2);
    h.replay();
    expect(locks(h.db)).toEqual(live);
  });

  it('[02a #59] LineWeightSet / LineComped (order = envelope stream_id) by the lock holder refresh last_activity_at; by another person they do not; no state change', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), locked('T1', 'S1'), placed('O1', 'S1'), placed('O2', 'S1'));
    const before = stateRows(h.db);
    const lastAt = h.now();

    h.append(weightSet('O1', { actor: BILAL }), comped('O2', { actor: BILAL }));
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: lastAt });

    h.append(weightSet('O1'));
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: h.now() });
    h.append(comped('O2'));
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: h.now() });
    expect(stateRows(h.db)).toEqual(before);
  });

  it('[02a §3.3] ItemRemoved (order = stream_id) and the §6.19 table events of the lock\'s seating by the holder are activity; OrderCancelled, OrderFoodServed, OrderFoodCleared, BillClosed are not', async () => {
    const h = await harness(cleanups);
    h.append(opened('T1', 'S1'), locked('T1', 'S1'), placed('O1', 'S1'), placed('O2', 'S1'), placed('O3', 'S1'));
    h.append(itemRemoved('O1', { actor: BILAL }));
    const lastAt = h.now() - 1_000;
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: lastAt });
    const before = stateRows(h.db);
    h.append(itemRemoved('O1'));
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: h.now() });
    expect(stateRows(h.db)).toEqual(before);
    const itemAt = h.now();

    h.append(
      ev('order', 'O3', 'OrderCancelled', { order_id: 'O3' }),
      ev('order', 'O1', 'OrderFoodServed', { order_id: 'O1' }),
      ev('order', 'O2', 'OrderFoodCleared', { order_id: 'O2', food_served: true }),
    );
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: itemAt });

    h.append(ev('table', 'T1', 'BillRequested', { seating_id: 'S1', table_id: 'T1', by_staff_id: ALI }));
    const billAt = h.now();
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: billAt });
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
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: h.now() });
    h.append(
      ev('table', 'T1', 'TableHolderChanged', {
        table_id: 'T1',
        seating_id: 'S1',
        from_staff_id: BILAL,
        to_staff_id: ALI,
        reason: 'take_over',
        by_staff_id: ALI,
      }),
    );
    const holderAt = h.now();
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: holderAt });
    h.append(ev('table', 'T1', 'BillClosed', { seating_id: 'S1' }));
    expect(lock(h.db, 'T1')).toMatchObject({ last_activity_at: holderAt });
  });
});
