import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { statementCounter } from '../../test/helpers/statement-counter';
import { readOnlyDb } from '../engine-host/read-only-tx';
import { cachedPrepare, clearStatementCache } from './statements';

// AD-125: the per-database prepared statement cache of 01d's hot paths (tick, projections, raise).

const opened: Database.Database[] = [];

function db(): Database.Database {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  opened.push(d);
  return d;
}

afterEach(() => {
  for (const d of opened.splice(0)) d.close();
});

const SELECT = 'SELECT id, v FROM t WHERE id = ?';
const INSERT = 'INSERT INTO t (v) VALUES (?)';

describe('cachedPrepare (AD-125)', () => {
  it('same db and SQL → the same statement object; another SQL → another statement', () => {
    const d = db();
    const a = cachedPrepare(d, SELECT);
    expect(cachedPrepare(d, SELECT)).toBe(a);
    expect(cachedPrepare(d, 'SELECT v FROM t')).not.toBe(a);
  });

  it('a different db → a different statement (no state shared across instances)', () => {
    const one = db();
    const two = db();
    const a = cachedPrepare(one, INSERT);
    const b = cachedPrepare(two, INSERT);
    expect(b).not.toBe(a);
    b.run('x');
    expect(one.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 0 });
    expect(two.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 1 });
  });

  it("a read-only view is never cached: each call goes through the view's checked prepare", () => {
    const d = db();
    const raw = cachedPrepare(d, SELECT);
    const view = readOnlyDb(d);
    const first = cachedPrepare(view, SELECT);
    expect(first).not.toBe(raw);
    expect(cachedPrepare(view, SELECT)).not.toBe(first);
    expect(first.readonly && first.reader).toBe(true);
  });

  it('a write SQL through a read-only view still throws, even when the raw db has it cached', () => {
    const d = db();
    cachedPrepare(d, INSERT).run('x');
    const view = readOnlyDb(d);
    expect(() => cachedPrepare(view, INSERT)).toThrow(/read-only view/);
    expect(() => cachedPrepare(view, INSERT)).toThrow(/read-only view/);
  });

  it('a statementCounter installed after a statement was cached still counts every execution', () => {
    const d = db();
    cachedPrepare(d, SELECT).get(1); // cached before the counter
    const counter = statementCounter(d);
    cachedPrepare(d, SELECT).get(1);
    cachedPrepare(d, SELECT).get(2);
    expect(counter.count).toBe(2);
    const counted = cachedPrepare(d, SELECT);
    expect(cachedPrepare(d, SELECT)).toBe(counted); // cached again, through the counter
  });

  it('clearStatementCache drops the db entry: the next call prepares again', () => {
    const d = db();
    const a = cachedPrepare(d, SELECT);
    clearStatementCache(d);
    expect(cachedPrepare(d, SELECT)).not.toBe(a);
  });
});
