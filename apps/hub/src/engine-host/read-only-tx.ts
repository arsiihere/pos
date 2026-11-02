import type Database from 'better-sqlite3';
import type { WriterTx } from './writer.js';

// 00 v1.6 H-3 / 01d §3.5 "Read-only contract": `prepare` (and 01d's `preRead`) run on this view, so a
// write there throws instead of landing before the PIN outcome is known. Enforced, not trusted.

const READ_ONLY_PROPS = new Set<PropertyKey>(['name', 'open', 'inTransaction', 'readonly', 'memory']);
const views = new WeakMap<Database.Database, Database.Database>();

/**
 * The connection a read-only view wraps (the view itself for any other db). Only an identity key for
 * per-hub lookups (01d's alert env); never hand the result to code that runs on the view.
 */
export function rawDbOf(db: Database.Database): Database.Database {
  return views.get(db) ?? db;
}

export function readOnlyDb(db: Database.Database): Database.Database {
  const prepare = (sql: string): Database.Statement => {
    const statement = db.prepare(sql);
    // `readonly` alone lets COMMIT / ROLLBACK / SAVEPOINT / ATTACH through (they do not write the file
    // themselves but end or widen the writer's transaction); `reader` (returns rows) excludes them.
    if (!statement.readonly || !statement.reader) {
      throw new Error('read-only view: only a statement that reads and returns rows is allowed');
    }
    return statement;
  };
  const view = new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return prepare;
      if (READ_ONLY_PROPS.has(prop)) return Reflect.get(target, prop, target) as unknown;
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value === 'function') {
        return () => {
          throw new Error(`read-only view: db.${String(prop)} is not allowed`);
        };
      }
      return value;
    },
    set() {
      throw new Error('read-only view: db is not writable');
    },
  });
  views.set(view, rawDbOf(db));
  return view;
}

export function readOnlyTx(tx: WriterTx): WriterTx {
  return {
    db: readOnlyDb(tx.db),
    state: tx.state,
    clock: tx.clock,
    ids: tx.ids,
    branchId: tx.branchId,
    append() {
      throw new Error('read-only view: tx.append is not allowed');
    },
    onCommit() {
      throw new Error('read-only view: tx.onCommit is not allowed');
    },
  };
}
