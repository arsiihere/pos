import { afterEach, describe, expect, it } from 'vitest';
import { readOnlyDb, readOnlyTx } from '../../src/engine-host/read-only-tx';
import { createTestHub, type TestHub } from '../helpers/test-hub';

// Transaction control and ATTACH report `Statement.readonly === true` but would end or widen the writer's
// transaction; write CTEs and RETURNING must be refused too (review fix round 1).
const WRITES_AND_TX_CONTROL = [
  'COMMIT',
  'END',
  'ROLLBACK',
  'BEGIN',
  'SAVEPOINT sp1',
  'RELEASE sp1',
  "ATTACH DATABASE ':memory:' AS other",
  'DETACH DATABASE other',
  `WITH x AS (SELECT 'b' AS b) INSERT INTO auth_lockouts (branch_id, subject_type, subject_id, failed_count, window_started_at, locked_until)
   SELECT b, 'staff', 's', 1, 0, NULL FROM x`,
  `INSERT INTO auth_lockouts (branch_id, subject_type, subject_id, failed_count, window_started_at, locked_until)
   VALUES ('b', 'staff', 's', 1, 0, NULL) RETURNING failed_count`,
];

describe('read-only transaction view', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const hub of hubs.splice(0)) await hub.close();
  });

  async function hub(): Promise<TestHub> {
    const created = await createTestHub();
    hubs.push(created);
    return created;
  }

  it('[00 H-3] readOnlyTx: append and onCommit throw, a write or transaction-control statement throws, SELECT works', async () => {
    const h = await hub();
    h.deps.writer.run((tx) => {
      const view = readOnlyTx(tx);
      expect(view.branchId).toBe(tx.branchId);
      expect(view.clock).toBe(tx.clock);
      expect(() => view.append([])).toThrow(/read-only/);
      expect(() => view.onCommit(() => undefined)).toThrow(/read-only/);
      expect(() => view.db.prepare('UPDATE auth_lockouts SET failed_count = 0')).toThrow(/read-only/);
      expect(() => view.db.prepare('DELETE FROM auth_lockouts')).toThrow(/read-only/);
      for (const sql of WRITES_AND_TX_CONTROL) expect(() => view.db.prepare(sql), sql).toThrow(/read-only/);
      expect(view.db.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 });
      expect(view.db.inTransaction).toBe(true);
    });
    expect(h.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 0 });
  });

  it('[00 H-3] readOnlyDb: write and transaction-control statements and exec / pragma / transaction throw, SELECT works', async () => {
    const h = await hub();
    const db = readOnlyDb(h.deps.db);
    expect(() => db.prepare('UPDATE auth_lockouts SET failed_count = 0')).toThrow(/read-only/);
    expect(() =>
      db.prepare(
        `INSERT INTO auth_lockouts (branch_id, subject_type, subject_id, failed_count, window_started_at, locked_until)
         VALUES ('b', 'staff', 's', 1, 0, NULL)`,
      ),
    ).toThrow(/read-only/);
    for (const sql of WRITES_AND_TX_CONTROL) expect(() => db.prepare(sql), sql).toThrow(/read-only/);
    expect(() => db.exec('DELETE FROM auth_lockouts')).toThrow(/read-only/);
    expect(() => db.pragma('user_version = 7')).toThrow(/read-only/);
    expect(() => db.transaction(() => undefined)).toThrow(/read-only/);
    expect(db.prepare('SELECT 1 AS one').get()).toEqual({ one: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM auth_lockouts').get()).toEqual({ n: 0 });
  });
});
