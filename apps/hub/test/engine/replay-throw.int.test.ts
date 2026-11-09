// 03a §3.12 step 3, task 20 review (02p task 15b review I-1): a fold that throws a plain Error inside a replay chunk.
// replayEngine reports the diagnostics of the chunk's earlier events once (reportBeforeThrow) and rethrows; boot stops.
// The throw is a test double around @pos/engine's folds (one event, stream_id BOOM); no product code is involved.
import { fileURLToPath } from 'node:url';
import { initialEngineState, type Diagnostic } from '@pos/engine';
import type { PosEvent } from '@pos/events';
import { aStockAdded, aStockSet } from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replayEngine } from '../../src/engine-host/replay';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const BOOM = 'BOOM';
vi.mock('@pos/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pos/engine')>();
  const boom = (e: PosEvent): void => {
    if (e.stream_id === BOOM) throw new Error('fold failed (test double)');
  };
  return {
    ...real,
    applyEvent: (...args: Parameters<typeof real.applyEvent>) => {
      boom(args[1]);
      return real.applyEvent(...args);
    },
    applyEvents: (...args: Parameters<typeof real.applyEvents>) => {
      args[1].forEach(boom);
      return real.applyEvents(...args);
    },
  };
});

const BRANCH = 'branch-1';
const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

function insertRaw(db: Database.Database, events: readonly PosEvent[]): void {
  const insert = db.prepare(
    `INSERT INTO events (event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
       schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of events) {
    insert.run(e.event_id, 'tenant-a', BRANCH, e.stream_type, e.stream_id, e.event_type, e.schema_version, JSON.stringify(e.payload), e.occurred_at, e.recorded_at, e.actor_id, e.device_id, e.seq);
  }
}

describe('[task 20 review] replayEngine: a plain Error inside a chunk', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  it('[03a §3.12, task 20 review] the earlier events\' diagnostics are reported once, then the error is rethrown', async () => {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    await runMigrations(fx.db, { dir: migrations, clock: fixedClock(T) });
    const set = aStockSet({ stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 5, unit: 'g' } });
    const breach = aStockAdded({ stream_id: 'K1', payload: { stock_item_id: 'K1', quantity: 1, unit: 'piece' } });
    const boom = aStockSet({ stream_id: BOOM, payload: { stock_item_id: BOOM, on_hand: 1, unit: 'piece' } });
    const after = aStockAdded({ stream_id: 'K1', payload: { stock_item_id: 'K1', quantity: 1, unit: 'piece' } });
    const log = [set, breach, boom, after].map((e, i) => ({ ...e, seq: i + 1, event_id: `01J${String(i + 1).padStart(23, '0')}`, recorded_at: T + i, occurred_at: T + i }));
    insertRaw(fx.db, log);
    const reported: Diagnostic[] = [];
    expect(() => replayEngine(fx.db, BRANCH, 0, initialEngineState(), (d) => reported.push(d))).toThrow('fold failed (test double)');
    // One chunk (4 events < REPLAY_CHUNK): only the breach before the throw is reported, once; nothing after it.
    expect(reported.map((d) => [d.kind, d.event_id])).toEqual([['stock_breach', log[1]!.event_id]]);
  });
});
