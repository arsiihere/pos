/// <reference types="node" />
import Database from 'better-sqlite3';

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function openReadOnly(path: string): Database.Database {
  const db = new Database(path, { readonly: true });
  db.pragma('busy_timeout = 5000');
  return db;
}
