import { fileURLToPath } from 'node:url';
import type { EventDraft, PosEvent } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter } from '../../src/engine-host/writer';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { createProjectionRegistry } from '../../src/projections/registry';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const TENANT = 'tenant-1';
const BRANCH = 'branch-1';

describe('writer', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[F D45] state swaps only after COMMIT', async () => {
    const { db } = await migrated();
    const state = createStateHolder({ n: 0 });
    state.setReducer((current) => ({ n: current.n + 1 }));
    let during = -1;
    const writer = createWriter({
      db,
      clock: fixedClock(T),
      ids: testIdGen(),
      tenantId: TENANT,
      branchId: BRANCH,
      projections: createProjectionRegistry(),
      state,
      authGeneration: createAuthGeneration(),
      publish: () => undefined,
      testHooks: {
        beforeCommit() {
          during = state.get().n;
          expect(db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(1);
        },
      },
    });
    writer.run((tx) => {
      tx.append([hub('1')]);
    });
    expect(during).toBe(0);
    expect(state.get()).toEqual({ n: 1 });
  });

  it('[F D45] a throw in beforeCommit leaves state, events, lastSeq, generation and publish untouched', async () => {
    const { db } = await migrated();
    const state = createStateHolder({ n: 0 });
    state.setReducer((current) => ({ n: current.n + 1 }));
    const auth = createAuthGeneration();
    const published: PosEvent[][] = [];
    const writer = createWriter({
      db,
      clock: fixedClock(T),
      ids: testIdGen(),
      tenantId: TENANT,
      branchId: BRANCH,
      projections: createProjectionRegistry(),
      state,
      authGeneration: auth,
      publish: (events) => published.push(events),
      testHooks: {
        beforeCommit() {
          throw new Error('before commit');
        },
      },
    });
    expect(() =>
      writer.run((tx) => {
        tx.append([sessionEnded()]);
      }),
    ).toThrow(/before commit/);
    expect(state.get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(0);
    expect(writer.lastSeq()).toBe(0);
    expect(auth.current()).toBe(0);
    expect(published).toEqual([]);
  });

  it('[00 §3.1 M39] a committed SessionEnded bumps authGeneration once; other events do not', async () => {
    const { db } = await migrated();
    const state = createStateHolder({ n: 0 });
    state.setReducer((current) => current);
    const auth = createAuthGeneration();
    const writer = createWriter({
      db,
      clock: fixedClock(T),
      ids: testIdGen(),
      tenantId: TENANT,
      branchId: BRANCH,
      projections: createProjectionRegistry(),
      state,
      authGeneration: auth,
      publish: () => undefined,
    });
    writer.run((tx) => {
      tx.append([hub('1')]);
    });
    expect(auth.current()).toBe(0);
    writer.run((tx) => {
      tx.append([sessionEnded()]);
      tx.append([hub('2')]);
    });
    expect(auth.current()).toBe(1);
  });

  it('[00 §3.7] two appends in one run → consecutive seqs, one publish', async () => {
    const { db } = await migrated();
    const state = createStateHolder({ n: 0 });
    state.setReducer((current, _event) => ({ n: current.n + 1 }));
    const published: PosEvent[][] = [];
    const writer = createWriter({
      db,
      clock: fixedClock(T),
      ids: testIdGen(),
      tenantId: TENANT,
      branchId: BRANCH,
      projections: createProjectionRegistry(),
      state,
      authGeneration: createAuthGeneration(),
      publish: (events) => published.push(events),
    });
    const { appended } = writer.run((tx) => {
      tx.append([hub('1')]);
      tx.append([hub('2')]);
    });
    expect(appended.map((event) => event.seq)).toEqual([1, 2]);
    expect(published).toHaveLength(1);
    expect(published[0]?.map((event) => event.seq)).toEqual([1, 2]);
    expect(state.get()).toEqual({ n: 2 });
    expect(writer.lastSeq()).toBe(2);
  });

  async function migrated() {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    await runMigrations(fx.db, { dir: migrations, clock: fixedClock(T) });
    return fx;
  }
});

function hub(version: string): EventDraft {
  return {
    stream_type: 'hub',
    stream_id: BRANCH,
    event_type: 'HubProvisioned',
    schema_version: 1,
    payload: { tenant_id: TENANT, branch_id: BRANCH, hub_version: version },
    occurred_at: T,
    actor_id: null,
    device_id: 'device-1',
  };
}

function sessionEnded(): EventDraft {
  return {
    stream_type: 'staff',
    stream_id: 'staff-1',
    event_type: 'SessionEnded',
    schema_version: 1,
    payload: {
      session_id: 'session-1',
      kind: 'staff',
      staff_id: 'staff-1',
      station_id: null,
      reason: 'logout',
      ended_by: null,
    },
    occurred_at: T,
    actor_id: 'staff-1',
    device_id: 'device-1',
  };
}
