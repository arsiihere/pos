import { fileURLToPath } from 'node:url';
import type { EventDraft } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvents } from '../../src/engine-host/append-events';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const TENANT = 'tenant-1';
const BRANCH = 'branch-1';

describe('appendEvents', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[00 §10 #63] seq gap-free across 1 000 appends with forced rollbacks', async () => {
    const { db } = await migrated();
    const ctx = { clock: fixedClock(T), ids: testIdGen(), tenantId: TENANT, branchId: BRANCH };
    let committed = 0;
    for (let i = 0; i < 1000; i++) {
      const rollback = i % 3 === 0;
      try {
        db.transaction(() => {
          appendEvents(db, [draft(i)], ctx);
          if (rollback) throw new Error('forced rollback');
        }).immediate();
        committed += 1;
      } catch (error) {
        if (!rollback) throw error;
      }
    }
    const seqs = db.prepare('SELECT seq FROM events ORDER BY seq').pluck().all();
    expect(committed).toBe(666);
    expect(seqs).toEqual(Array.from({ length: committed }, (_, n) => n + 1));
    // 1 000 appends pass the 5 s default under full-suite load (01a reviews 10 and 16).
  }, 30_000);

  it('[F §4.1] outside a transaction throws', async () => {
    const { db } = await migrated();
    const ctx = { clock: fixedClock(T), ids: testIdGen(), tenantId: TENANT, branchId: BRANCH };
    expect(() => appendEvents(db, [draft(0)], ctx)).toThrow(/transaction/);
    expect(db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(0);
  });

  it('[F §4.1] invalid payload inserts nothing', async () => {
    const { db } = await migrated();
    const ctx = { clock: fixedClock(T), ids: testIdGen(), tenantId: TENANT, branchId: BRANCH };
    const bad: EventDraft = draft(0);
    bad.payload = { tenant_id: TENANT };
    db.transaction(() => {
      expect(() => appendEvents(db, [draft(1), bad], ctx)).toThrow();
    }).immediate();
    expect(db.prepare('SELECT COUNT(*) FROM events').pluck().get()).toBe(0);
  });

  async function migrated() {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    await runMigrations(fx.db, { dir: migrations, clock: fixedClock(T) });
    return fx;
  }
});

function draft(n: number) {
  return {
    stream_type: 'hub' as const,
    stream_id: BRANCH,
    event_type: 'HubProvisioned',
    schema_version: 1,
    payload: { tenant_id: TENANT, branch_id: BRANCH, hub_version: `0.0.${n}` },
    occurred_at: T,
    actor_id: null,
    device_id: 'device-1',
  };
}
