// Engine-lane boot tests (02p tasks 15, 17), kept out of boot.int.test.ts (platform A's file).
// 01a v2.3 #194 third clause (02p M-6): the boot fold counts StockTransferredOut — 03a v1.2 Q-5 puts it on
// ENGINE_REPLAY_EVENTS.stock, so step 3's stock statement reads it and the replayed state lowers on_hand as live does.
import { fileURLToPath } from 'node:url';
import { applyEvents, initialEngineState, stockOf, type Diagnostic } from '@pos/engine';
import type { PosEvent } from '@pos/events';
import { aStockSet } from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { replayEngine } from '../../src/engine-host/boot-steps';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const BRANCH = 'branch-1';
const TENANT = 'tenant-a';
const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

const eventIdOf = (seq: number): string => `01J${String(seq).padStart(23, '0')}`;
const stamped = (events: readonly PosEvent[], first: number): PosEvent[] =>
  events.map((event, i) => ({ ...event, tenant_id: TENANT, branch_id: BRANCH, seq: first + i, event_id: eventIdOf(first + i), recorded_at: T + i, occurred_at: T + i }));

function insertRaw(db: Database.Database, events: readonly PosEvent[]): void {
  const insert = db.prepare(
    `INSERT INTO events (event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
       schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const e of events) {
      insert.run(e.event_id, e.tenant_id, e.branch_id, e.stream_type, e.stream_id, e.event_type, e.schema_version, JSON.stringify(e.payload), e.occurred_at, e.recorded_at, e.actor_id, e.device_id, e.seq);
    }
  })();
}

const count = (id: string, on_hand: number): PosEvent => aStockSet({ stream_id: id, payload: { stock_item_id: id, on_hand, unit: 'piece' } });
const transferred = (id: string, quantity: number): PosEvent =>
  aStockSet({ event_type: 'StockTransferredOut', schema_version: 1, stream_id: id, payload: { stock_item_id: id, quantity, zone_id: 'Z1' } });

describe('03a boot step 3: the engine-lane id sets', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  async function migrated(): Promise<Database.Database> {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    await runMigrations(fx.db, { dir: migrations, clock: fixedClock(T) });
    return fx.db;
  }

  it('[01a #194] the boot fold counts StockTransferredOut', async () => {
    const db = await migrated();
    // K1 counted 5, 2 moved to a zone, then 4 more (clamps at 0, a breach); an item never counted moves 1 (a breach, no entry).
    const log = stamped([count('K1', 5), transferred('K1', 2), count('K2', 7), transferred('K2', 3), transferred('K1', 4), transferred('NEVER_SEEN', 1)], 1);
    insertRaw(db, log);
    const reported: Diagnostic[] = [];
    const out = replayEngine(db, BRANCH, 0, initialEngineState(), (d) => reported.push(d));
    expect(out.replayed).toBe(log.length);
    expect(stockOf(out.state, 'K1').on_hand).toBe(0);
    expect(stockOf(out.state, 'K2').on_hand).toBe(4);
    expect(out.state.stock.NEVER_SEEN).toBeUndefined();
    expect(reported.map((d) => [d.kind, d.event_id])).toEqual([
      ['stock_breach', log[4]!.event_id],
      ['stock_breach', log[5]!.event_id],
    ]);
    // Boot = live: the same state as folding the log in the hub's non-strict mode.
    expect({ ...out.state, diagnostics: [] }).toEqual({ ...applyEvents(initialEngineState(), log, { strict: false }), diagnostics: [] });
  });
});
