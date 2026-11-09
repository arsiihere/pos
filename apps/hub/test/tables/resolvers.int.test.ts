import type { AlertTarget, DirectoryInput } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alertDirectoryOf } from '../../src/alerts/raise';
import {
  hasTargetResolver,
  registerTargetResolver,
  resolveTargets,
  targetKey,
  unregisterTargetResolver,
  type ResolvedTarget,
} from '../../src/alerts/targets';
import type { WriterTx } from '../../src/engine-host/writer';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 02a §4.2 resolver rows, §6.16, 01d D-1: the real `table_team` / `zone_order_taker` resolvers, registered by
// registerTables (buildHubServer), on the real 0012 tables. Seatings are seeded with SQL (never the projection).

const ALI = 'S_ALI'; // assignee of the T-A* tables (take-order allowed)
const BILAL = 'S_BILAL'; // holder
const W1 = 'S_W1'; // ALI's reports
const W2 = 'S_W2';
const W3 = 'S_W3'; // BILAL's report

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const owner = base.staff[0]!;
  const person = (staff_id: string, lead_staff_id: string | null, assigned_table_ids: string[] = []) => ({
    ...owner,
    staff_id,
    display_name: staff_id,
    lead_staff_id,
    assigned_table_ids,
  });
  const aliTables = Array.from({ length: 20 }, (_, i) => tableId(i));
  return {
    ...base,
    staff: [...base.staff, person(ALI, null, [...aliTables, 'T-B1']), person(BILAL, null), person(W1, ALI), person(W2, ALI), person(W3, BILAL)],
  };
}

const tableId = (i: number) => `T-A${String(i).padStart(2, '0')}`;

function seatOpen(h: TestHub, seatingId: string, tableIds: string[], holder: string): void {
  const insertSeating = h.deps.db.prepare(
    `INSERT INTO seatings (seating_id, primary_table_id, state, holder_staff_id, opened_at) VALUES (?, ?, 'SEATED', ?, ?)`,
  );
  const insertTable = h.deps.db.prepare('INSERT INTO seating_tables (table_id, seating_id, joined_at) VALUES (?, ?, ?)');
  insertSeating.run(seatingId, tableIds[0], holder, h.clock.branchNow());
  for (const t of tableIds) insertTable.run(t, seatingId, h.clock.branchNow());
}

function working(h: TestHub, staffId: string): string {
  const { deviceId } = pairDevice(h, { type: 'tablet' });
  return openSession(h, { kind: 'staff', staffId, deviceId }).sessionId;
}

describe('02a resolvers (§4.2, §6.16, 01d D-1)', () => {
  let h: TestHub;
  beforeEach(async () => {
    h = await createTestHub();
    await seedDirectory(h, await directory());
  });
  afterEach(async () => {
    await h.close();
  });

  const run = <R>(fn: (tx: WriterTx) => R): R => h.deps.writer.run(fn).result;

  it('[02a #21] one batch with owner + direct for one table → [holder] and W ∪ {holder}; owner_staff_id = holder', () => {
    seatOpen(h, 'SEAT-1', [tableId(0)], BILAL);
    working(h, W1);
    working(h, W3);
    const owner: AlertTarget = { kind: 'table_team', table_id: tableId(0), depth: 'owner' };
    const direct: AlertTarget = { kind: 'table_team', table_id: tableId(0), depth: 'direct' };
    const out = run((tx) => resolveTargets(tx, [owner, direct]));
    expect(out.get(targetKey(owner))).toEqual({ staff_ids: [BILAL], device_ids: [], owner_staff_id: BILAL });
    const found = out.get(targetKey(direct)) as ResolvedTarget;
    expect([...found.staff_ids].sort()).toEqual([BILAL, W1].sort());
    expect(found).toMatchObject({ device_ids: [], owner_staff_id: BILAL });
  });

  it('[02a #21] a missing depth is direct; ended sessions do not count; the assignee comes from the primary table', () => {
    // merged seating: primary T-B1 (assigned to ALI) + T-B2 (unassigned); the target names the joined table
    seatOpen(h, 'SEAT-M', ['T-B1', 'T-B2'], BILAL);
    working(h, W1);
    endSessionNow(h, working(h, W2));
    working(h, W3);
    const target: AlertTarget = { kind: 'table_team', table_id: 'T-B2' };
    const out = run((tx) => resolveTargets(tx, [target]));
    expect(targetKey(target)).toBe('table_team:T-B2:direct');
    expect(out.get(targetKey(target))).toEqual({ staff_ids: [W1, BILAL], device_ids: [], owner_staff_id: BILAL });
  });

  it("[02a #21] the assignee's reports off → the holder's working reports + holder; nobody → [holder]", () => {
    seatOpen(h, 'SEAT-1', [tableId(0)], BILAL);
    const target: AlertTarget = { kind: 'table_team', table_id: tableId(0), depth: 'direct' };
    expect(run((tx) => resolveTargets(tx, [target])).get(targetKey(target))?.staff_ids).toEqual([BILAL]);
    working(h, W3);
    expect(run((tx) => resolveTargets(tx, [target])).get(targetKey(target))?.staff_ids).toEqual([W3, BILAL]);
  });

  it('[02a §4.2] a table with no open seating has no entry (no staff, no owner marker)', () => {
    seatOpen(h, 'SEAT-C', [tableId(1)], BILAL);
    h.deps.db.prepare('UPDATE seatings SET closed_at = ?, state = ? WHERE seating_id = ?').run(h.clock.branchNow(), 'CLOSED', 'SEAT-C');
    const closed: AlertTarget = { kind: 'table_team', table_id: tableId(1) };
    const free: AlertTarget = { kind: 'table_team', table_id: tableId(2), depth: 'owner' };
    const out = run((tx) => resolveTargets(tx, [closed, free]));
    expect(out.size).toBe(0);
  });

  it('[02a #21] one statement for 40 targets', () => {
    for (let i = 0; i < 20; i += 1) seatOpen(h, `SEAT-${i}`, [tableId(i)], i % 2 === 0 ? BILAL : ALI);
    working(h, W1);
    working(h, W3);
    const targets: AlertTarget[] = Array.from({ length: 20 }, (_, i) => [
      { kind: 'table_team' as const, table_id: tableId(i), depth: 'owner' as const },
      { kind: 'table_team' as const, table_id: tableId(i), depth: 'direct' as const },
    ]).flat();
    expect(targets).toHaveLength(40);
    const counter = statementCounter(h.deps.db);
    const { out, count } = run((tx) => {
      counter.reset();
      const resolved = resolveTargets(tx, targets);
      return { out: resolved, count: counter.count };
    });
    expect(count).toBe(1);
    expect(out.size).toBe(40);
    for (let i = 0; i < 20; i += 1) {
      const holder = i % 2 === 0 ? BILAL : ALI;
      expect(out.get(`table_team:${tableId(i)}:owner`)).toEqual({ staff_ids: [holder], device_ids: [], owner_staff_id: holder });
      expect(out.get(`table_team:${tableId(i)}:direct`)).toEqual({ staff_ids: [W1, holder], device_ids: [], owner_staff_id: holder });
    }
  });

  it('[02a §6.16] zone_order_taker: 0 statements, = assignedOrderTaker(table_id)', () => {
    const assigned: AlertTarget = { kind: 'zone_order_taker', table_id: tableId(3) };
    const none: AlertTarget = { kind: 'zone_order_taker', table_id: 'T-NONE' };
    const counter = statementCounter(h.deps.db);
    const { out, count, expected } = run((tx) => {
      counter.reset();
      const resolved = resolveTargets(tx, [assigned, none]);
      return { out: resolved, count: counter.count, expected: alertDirectoryOf(tx).assignedOrderTaker(tableId(3)) };
    });
    expect(count).toBe(0);
    expect(expected).toBe(ALI);
    expect(out.get(targetKey(assigned))).toEqual({ staff_ids: [ALI], device_ids: [] });
    expect(out.get(targetKey(none))).toEqual({ staff_ids: [], device_ids: [] });
  });
});

describe('02a SG-6: registerTables registers a resolver only when none is registered', () => {
  afterEach(() => {
    unregisterTargetResolver('table_team');
    unregisterTargetResolver('zone_order_taker');
  });

  it('[02a SG-6] registerTables skips a kind a test registered first', async () => {
    unregisterTargetResolver('table_team');
    unregisterTargetResolver('zone_order_taker');
    const fake = new Map<string, ResolvedTarget>([['table_team:T-X:direct', { staff_ids: ['S_FAKE'], device_ids: [] }]]);
    registerTargetResolver('table_team', () => fake);
    const h = await createTestHub();
    try {
      expect(hasTargetResolver('zone_order_taker')).toBe(true); // the real one, registered by registerTables
      const out = h.deps.writer.run((tx) => resolveTargets(tx, [{ kind: 'table_team', table_id: 'T-X' }])).result;
      expect(out.get('table_team:T-X:direct')).toEqual({ staff_ids: ['S_FAKE'], device_ids: [] });
    } finally {
      await h.close();
    }
  });
});
