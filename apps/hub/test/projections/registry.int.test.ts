import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvents } from '../../src/engine-host/append-events';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { createProjectionRegistry, type Projection } from '../../src/projections/registry';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const TENANT = 'tenant-1';
const BRANCH = 'branch-1';

describe('projection registry', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[00 §10 #67] checkpoint behind MAX(seq) → replay from the checkpoint gives the same rows as live application', async () => {
    const live = await migrated();
    const liveRows = applyLive(live.db, 5);
    const caught = await migrated();
    const modes: string[] = [];
    const seen: Projection = {
      name: 'counter',
      eventTypes: ['HubProvisioned'],
      apply(tx, event, mode) {
        modes.push(mode);
        tx.prepare('INSERT INTO proj_counter (seq) VALUES (?)').run(event.seq);
      },
    };
    caught.db.exec('CREATE TABLE proj_counter (seq INTEGER PRIMARY KEY)');
    const registry = createProjectionRegistry();
    registry.register(seen);
    const ctx = context();
    caught.db.transaction(() => {
      const first = appendEvents(caught.db, drafts(3), ctx);
      registry.applyAll(caught.db, first, BRANCH);
    }).immediate();
    caught.db.transaction(() => {
      appendEvents(caught.db, drafts(2), ctx);
    }).immediate();
    expect(caught.db.prepare('SELECT MAX(seq) FROM events').pluck().get()).toBe(5);
    expect(caught.db.prepare('SELECT last_seq FROM projection_checkpoints WHERE projection = ?').pluck().get('counter')).toBe(3);
    registry.catchUp(caught.db, BRANCH);
    expect(rows(caught.db)).toEqual(liveRows);
    expect(rows(caught.db)).toEqual([1, 2, 3, 4, 5]);
    expect(modes).toEqual(['live', 'live', 'live', 'catchup', 'catchup']);
  });

  it('[00 §3.1 M48] applyAll advances every checkpoint, including projections that ignore the events', async () => {
    const { db } = await migrated();
    const matched: number[] = [];
    const ignored: number[] = [];
    const registry = createProjectionRegistry();
    registry.register({
      name: 'matched',
      eventTypes: ['HubProvisioned'],
      apply(_tx, event) {
        matched.push(event.seq);
      },
    });
    registry.register({
      name: 'ignored',
      eventTypes: ['SessionEnded'],
      apply(_tx, event) {
        ignored.push(event.seq);
      },
    });
    db.transaction(() => {
      const events = appendEvents(db, drafts(2), context());
      registry.applyAll(db, events, BRANCH);
    }).immediate();
    expect(matched).toEqual([1, 2]);
    expect(ignored).toEqual([]);
    expect(db.prepare('SELECT projection, last_seq FROM projection_checkpoints ORDER BY projection').all()).toEqual([
      { projection: 'ignored', last_seq: 2 },
      { projection: 'matched', last_seq: 2 },
    ]);
  });

  it('[00 §3.1 M48] no checkpoint row: with reset → reset and full replay; forward-only → replay from 0 without reset', async () => {
    const { db } = await migrated();
    db.exec('CREATE TABLE proj_reset (seq INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE proj_forward (seq INTEGER PRIMARY KEY)');
    const resets: string[] = [];
    const registry = createProjectionRegistry();
    registry.register({
      name: 'with-reset',
      eventTypes: ['HubProvisioned'],
      reset(tx) {
        resets.push('reset');
        tx.exec('DELETE FROM proj_reset');
        tx.prepare('INSERT INTO proj_reset (seq) VALUES (0)').run();
      },
      apply(tx, event) {
        tx.prepare('INSERT INTO proj_reset (seq) VALUES (?)').run(event.seq);
      },
    });
    registry.register({
      name: 'forward-only',
      eventTypes: ['HubProvisioned'],
      apply(tx, event) {
        tx.prepare('INSERT INTO proj_forward (seq) VALUES (?)').run(event.seq);
      },
    });
    db.transaction(() => {
      appendEvents(db, drafts(4), context());
    }).immediate();
    db.prepare('INSERT INTO proj_reset (seq) VALUES (99)').run();
    db.prepare('INSERT INTO proj_forward (seq) VALUES (7)').run();
    registry.catchUp(db, BRANCH);
    expect(resets).toEqual(['reset']);
    expect(db.prepare('SELECT seq FROM proj_reset ORDER BY seq').pluck().all()).toEqual([0, 1, 2, 3, 4]);
    expect(db.prepare('SELECT seq FROM proj_forward ORDER BY seq').pluck().all()).toEqual([1, 2, 3, 4, 7]);
    expect(db.prepare('SELECT projection, last_seq FROM projection_checkpoints ORDER BY projection').all()).toEqual([
      { projection: 'forward-only', last_seq: 4 },
      { projection: 'with-reset', last_seq: 4 },
    ]);
  });

  it('[00 §3.1 M48] a checkpoint at MAX(seq) does not reset or replay', async () => {
    const { db } = await migrated();
    db.exec('CREATE TABLE proj_reset (seq INTEGER PRIMARY KEY)');
    const resets: string[] = [];
    const registry = createProjectionRegistry();
    registry.register({
      name: 'with-reset',
      eventTypes: ['HubProvisioned'],
      reset(tx) {
        resets.push('reset');
        tx.exec('DELETE FROM proj_reset');
      },
      apply(tx, event) {
        tx.prepare('INSERT INTO proj_reset (seq) VALUES (?)').run(event.seq);
      },
    });
    db.transaction(() => {
      appendEvents(db, drafts(3), context());
    }).immediate();
    db.prepare('INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, ?, ?)').run(
      BRANCH,
      'with-reset',
      3,
    );
    db.prepare('INSERT INTO proj_reset (seq) VALUES (7)').run();
    registry.catchUp(db, BRANCH);
    expect(resets).toEqual([]);
    expect(db.prepare('SELECT seq FROM proj_reset').pluck().all()).toEqual([7]);
    expect(db.prepare('SELECT last_seq FROM projection_checkpoints WHERE projection = ?').pluck().get('with-reset')).toBe(3);
  });

  it('[00 §3.8] afterCatchUp runs inside the catch-up transaction', async () => {
    const behind = await migrated();
    behind.db.exec('CREATE TABLE proj_forward (seq INTEGER PRIMARY KEY)');
    const registry = createProjectionRegistry();
    registry.register({
      name: 'forward-only',
      eventTypes: ['HubProvisioned'],
      apply(tx, event) {
        tx.prepare('INSERT INTO proj_forward (seq) VALUES (?)').run(event.seq);
      },
    });
    behind.db.transaction(() => {
      appendEvents(behind.db, drafts(2), context());
    }).immediate();
    let sawTransaction = false;
    registry.afterCatchUp((tx) => {
      sawTransaction = tx.inTransaction;
      tx.prepare('INSERT INTO proj_forward (seq) VALUES (99)').run();
    });
    registry.catchUp(behind.db, BRANCH);
    expect(sawTransaction).toBe(true);
    expect(behind.db.prepare('SELECT seq FROM proj_forward ORDER BY seq').pluck().all()).toEqual([1, 2, 99]);

    const rolling = await migrated();
    rolling.db.exec('CREATE TABLE proj_forward (seq INTEGER PRIMARY KEY)');
    const failing = createProjectionRegistry();
    failing.register({
      name: 'forward-only',
      eventTypes: ['HubProvisioned'],
      apply(tx, event) {
        tx.prepare('INSERT INTO proj_forward (seq) VALUES (?)').run(event.seq);
      },
    });
    rolling.db.transaction(() => {
      appendEvents(rolling.db, drafts(2), context());
    }).immediate();
    failing.afterCatchUp(() => {
      throw new Error('hook failed');
    });
    expect(() => failing.catchUp(rolling.db, BRANCH)).toThrow(/hook failed/);
    expect(rolling.db.prepare('SELECT COUNT(*) FROM proj_forward').pluck().get()).toBe(0);
    expect(rolling.db.prepare('SELECT COUNT(*) FROM projection_checkpoints').pluck().get()).toBe(0);

    const current = await migrated();
    current.db.transaction(() => {
      appendEvents(current.db, drafts(2), context());
    }).immediate();
    current.db
      .prepare('INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, ?, ?)')
      .run(BRANCH, 'idle', 2);
    const idle = createProjectionRegistry();
    idle.register({
      name: 'idle',
      eventTypes: ['HubProvisioned'],
      apply() {
        throw new Error('replayed');
      },
    });
    let idleInTransaction = false;
    idle.afterCatchUp((tx) => {
      idleInTransaction = tx.inTransaction;
    });
    idle.catchUp(current.db, BRANCH);
    expect(idleInTransaction).toBe(true);
    expect(current.db.prepare('SELECT last_seq FROM projection_checkpoints WHERE projection = ?').pluck().get('idle')).toBe(2);
  });

  async function migrated() {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    await runMigrations(fx.db, { dir: migrations, clock: fixedClock(T) });
    return fx;
  }
});

function applyLive(db: Database.Database, n: number): number[] {
  db.exec('CREATE TABLE proj_counter (seq INTEGER PRIMARY KEY)');
  const registry = createProjectionRegistry();
  registry.register(counter('counter'));
  db.transaction(() => {
    const events = appendEvents(db, drafts(n), context());
    registry.applyAll(db, events, BRANCH);
  }).immediate();
  return rows(db);
}

function counter(name: string): Projection {
  return {
    name,
    eventTypes: ['HubProvisioned'],
    apply(tx, event) {
      tx.prepare('INSERT INTO proj_counter (seq) VALUES (?)').run(event.seq);
    },
  };
}

function rows(db: Database.Database): number[] {
  return db.prepare('SELECT seq FROM proj_counter ORDER BY seq').pluck().all() as number[];
}

function context() {
  return { clock: fixedClock(T), ids: testIdGen(), tenantId: TENANT, branchId: BRANCH };
}

function drafts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    stream_type: 'hub' as const,
    stream_id: BRANCH,
    event_type: 'HubProvisioned',
    schema_version: 1,
    payload: { tenant_id: TENANT, branch_id: BRANCH, hub_version: `0.0.${i}` },
    occurred_at: T,
    actor_id: null,
    device_id: 'device-1',
  }));
}
