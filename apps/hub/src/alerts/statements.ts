import type Database from 'better-sqlite3';
import { rawDbOf } from '../engine-host/read-only-tx.js';

// AD-125 (§7, #58): prepared statements of 01d's hot paths (tick, projections, raise) are cached per
// database instance, lazily (prepared on first use), with no state shared across instances: a WeakMap keyed
// by the connection object. `clearStatementCache` deletes the entry when the hub closes (registerAlerts'
// onClose, before boot closes the db); otherwise it goes with the db when the db is collected.
// - A read-only view (readOnlyDb / readOnlyTx) is never cached: every call goes through the view's own
//   checked `prepare`, so a write statement can never escape through a view. rawDbOf is used only to tell a
//   view from a connection, never to prepare on the raw connection.
// - The entry remembers the `db.prepare` function it was filled through. When that function changes (a test's
//   statementCounter or recorder wraps `db.prepare`), the entry is dropped and statements are prepared again
//   through the wrapper, so every execution after the wrap is counted.

interface Entry {
  prepare: Database.Database['prepare'];
  statements: Map<string, Database.Statement>;
}

const caches = new WeakMap<Database.Database, Entry>();

/** `db.prepare(sql)`, cached per connection (AD-125). A read-only view always prepares through its check. */
export function cachedPrepare(db: Database.Database, sql: string): Database.Statement {
  if (rawDbOf(db) !== db) return db.prepare(sql);
  const prepare = db.prepare;
  let entry = caches.get(db);
  if (entry === undefined || entry.prepare !== prepare) {
    entry = { prepare, statements: new Map() };
    caches.set(db, entry);
  }
  let statement = entry.statements.get(sql);
  if (statement === undefined) {
    statement = db.prepare(sql);
    entry.statements.set(sql, statement);
  }
  return statement;
}

/** Drops the connection's cached statements (hub close). */
export function clearStatementCache(db: Database.Database): void {
  caches.delete(db);
}
