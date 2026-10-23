import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock, T } from '../../src/lib/clock';
import { openDb, openReadOnly } from '../../src/db/connection';
import { MigrationChecksumError, runMigrations } from '../../src/db/migrate';

const fixtures = fileURLToPath(new URL('./fixtures/migrations-a', import.meta.url));

describe('sqlite migrations', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('[F §6.8] applies pending files and records checksums', async () => {
    const dir = scratch(dirs);
    const db = openDb(join(dir, 'pos.sqlite'));
    const result = await runMigrations(db, { dir: fixtures, clock: fixedClock(T) });
    expect(result).toEqual({ from: 0, to: 2, applied: ['0001_a.sql', '0002_b.sql'] });
    expect(db.prepare('SELECT name FROM a').pluck().get()).toBe('a');
    expect(db.prepare('SELECT id FROM b').pluck().get()).toBe(2);
    const rows = db.prepare('SELECT version, name, applied_at FROM migration_checksums ORDER BY version').all();
    expect(rows).toEqual([
      { version: 1, name: '0001_a.sql', applied_at: T },
      { version: 2, name: '0002_b.sql', applied_at: T },
    ]);
    const again = await runMigrations(db, { dir: fixtures, clock: fixedClock(T + 1) });
    expect(again).toEqual({ from: 2, to: 2, applied: [] });
    db.close();
  });

  it('[F §6.8] refuses when an applied file changed (the checksum half of #64)', async () => {
    const dir = scratch(dirs);
    const migrations = join(dir, 'migrations');
    cpSync(fixtures, migrations, { recursive: true });
    const db = openDb(join(dir, 'pos.sqlite'));
    await runMigrations(db, { dir: migrations, clock: fixedClock(T) });
    writeFileSync(join(migrations, '0001_a.sql'), 'CREATE TABLE a (id INTEGER PRIMARY KEY);\n', 'utf8');
    await expect(runMigrations(db, { dir: migrations, clock: fixedClock(T) })).rejects.toBeInstanceOf(MigrationChecksumError);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(db.prepare('SELECT name FROM a').pluck().get()).toBe('a');
    db.close();
  });

  it('[F §6.8] calls backup once before the first pending file when user_version > 0', async () => {
    const dir = scratch(dirs);
    const migrations = join(dir, 'migrations');
    mkdirSync(migrations);
    writeFileSync(join(migrations, '0001_a.sql'), 'CREATE TABLE a (id INTEGER PRIMARY KEY);\n');
    const db = openDb(join(dir, 'pos.sqlite'));
    const calls: Array<[number, number]> = [];
    const backup = (from: number, to: number) => {
      calls.push([from, to]);
      return Promise.resolve();
    };
    await runMigrations(db, { dir: migrations, clock: fixedClock(T), backup });
    expect(calls).toEqual([]);
    writeFileSync(join(migrations, '0002_b.sql'), 'CREATE TABLE b (id INTEGER PRIMARY KEY);\n');
    writeFileSync(join(migrations, '0003_c.sql'), 'CREATE TABLE c (id INTEGER PRIMARY KEY);\n');
    await runMigrations(db, { dir: migrations, clock: fixedClock(T), backup });
    expect(calls).toEqual([[1, 3]]);
    db.close();
  });

  it('[F §6.8] a failing file rolls back only itself', async () => {
    const dir = scratch(dirs);
    const migrations = join(dir, 'migrations');
    mkdirSync(migrations);
    writeFileSync(join(migrations, '0001_a.sql'), "CREATE TABLE a (id INTEGER PRIMARY KEY);\nINSERT INTO a (id) VALUES (1);\n");
    writeFileSync(
      join(migrations, '0002_b.sql'),
      'CREATE TABLE b (id INTEGER PRIMARY KEY);\nINSERT INTO missing (id) VALUES (1);\n',
    );
    const db = openDb(join(dir, 'pos.sqlite'));
    await expect(runMigrations(db, { dir: migrations, clock: fixedClock(T) })).rejects.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(db.prepare('SELECT id FROM a').pluck().get()).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'b'").get()).toBeUndefined();
    expect(db.prepare('SELECT version FROM migration_checksums').pluck().all()).toEqual([1]);
    db.close();
  });

  it('[F §6.8] openDb sets WAL and synchronous FULL', () => {
    const dir = scratch(dirs);
    const path = join(dir, 'pos.sqlite');
    const db = openDb(path);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(2);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    db.exec('CREATE TABLE seen (id INTEGER PRIMARY KEY); INSERT INTO seen (id) VALUES (7);');
    db.close();
    const reader = openReadOnly(path);
    expect(reader.prepare('SELECT id FROM seen').pluck().get()).toBe(7);
    expect(() => reader.exec('INSERT INTO seen (id) VALUES (8)')).toThrow();
    reader.close();
  });

  it('[F §6.8] foreign-keys-off rebuilds a referenced table and foreign_key_check blocks a bad row', async () => {
    const dir = scratch(dirs);
    const migrations = join(dir, 'migrations');
    mkdirSync(migrations);
    writeFileSync(
      join(migrations, '0001_a.sql'),
      `CREATE TABLE parent (id INTEGER PRIMARY KEY);
       CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id));
       INSERT INTO parent (id) VALUES (1);
       INSERT INTO child (id, parent_id) VALUES (1, 1);`,
    );
    writeFileSync(
      join(migrations, '0002_b.sql'),
      `-- migrate:foreign-keys-off
       CREATE TABLE parent_new (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
       INSERT INTO parent_new (id, label) SELECT id, 'kept' FROM parent;
       DROP TABLE parent;
       ALTER TABLE parent_new RENAME TO parent;`,
    );
    const db = openDb(join(dir, 'pos.sqlite'));
    await runMigrations(db, { dir: migrations, clock: fixedClock(T) });
    expect(db.prepare('SELECT label FROM parent').pluck().get()).toBe('kept');
    expect(db.prepare('SELECT parent_id FROM child').pluck().get()).toBe(1);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();

    const badDir = join(dir, 'bad');
    mkdirSync(badDir);
    writeFileSync(join(badDir, '0001_a.sql'), "CREATE TABLE parent (id INTEGER PRIMARY KEY);\nINSERT INTO parent (id) VALUES (1);\nCREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id));\n");
    writeFileSync(join(badDir, '0002_b.sql'), '-- migrate:foreign-keys-off\nINSERT INTO child (id, parent_id) VALUES (1, 99);\n');
    const bad = openDb(join(dir, 'bad.sqlite'));
    await expect(runMigrations(bad, { dir: badDir, clock: fixedClock(T) })).rejects.toThrow();
    expect(bad.pragma('user_version', { simple: true })).toBe(1);
    expect(bad.prepare('SELECT COUNT(*) FROM child').pluck().get()).toBe(0);
    expect(bad.pragma('foreign_keys', { simple: true })).toBe(1);
    bad.close();
  });
});

function scratch(dirs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pos-db-'));
  dirs.push(dir);
  return dir;
}
