import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HubConfigSchema, type HubConfig } from '../../src/config/schema';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { deleteLeftoverPlaintext, makePreMigrateBackup } from '../../src/db/pre-migrate-backup';
import { fixedClock, T } from '../../src/lib/clock';
import { decryptFile } from '../../src/lib/crypto-file';
import { testSecrets } from '../../src/lib/secrets';

const KEY = Buffer.alloc(32, 9);

describe('pre-migration backup', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      chmodSync(dir, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[00 §10 #64] pre-migration backup is encrypted and decrypts to the old user_version', async () => {
    const { dataDir, backupDir } = scratch(dirs);
    const db = openDb(join(dataDir, 'hub.sqlite'));
    const migrations = join(dataDir, 'migrations');
    mkdirSync(migrations);
    writeFileSync(join(migrations, '0001_a.sql'), 'CREATE TABLE marker (id INTEGER PRIMARY KEY);\nINSERT INTO marker (id) VALUES (1);\n');
    await runMigrations(db, { dir: migrations, clock: fixedClock(T) });
    writeFileSync(join(migrations, '0002_b.sql'), 'CREATE TABLE after_backup (id INTEGER PRIMARY KEY);\n');
    const cfg = config({ data_dir: dataDir, backup_dir: backupDir });
    await runMigrations(db, {
      dir: migrations,
      clock: fixedClock(T),
      backup: makePreMigrateBackup({ db, config: cfg, secrets: testSecrets() }),
    });
    const enc = join(backupDir, 'pre-migrate-1-2.sqlite.enc');
    expect(existsSync(enc)).toBe(true);
    expect(existsSync(join(dataDir, 'pre-migrate-1-2.sqlite'))).toBe(false);
    expect(db.pragma('user_version', { simple: true })).toBe(2);

    const restoredPath = join(dataDir, 'restored.sqlite');
    await decryptFile(enc, restoredPath, KEY);
    const restored = openDb(restoredPath);
    expect(restored.pragma('user_version', { simple: true })).toBe(1);
    expect(restored.prepare('SELECT id FROM marker').pluck().get()).toBe(1);
    expect(restored.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'after_backup'").get()).toBeUndefined();
    restored.close();
    db.close();
  });

  it('[00 §10 #124] backup_dir missing → data_dir; both unwritable → throws and no migration applied', async () => {
    const missing = scratch(dirs);
    const db = openDb(join(missing.dataDir, 'hub.sqlite'));
    const migrations = join(missing.dataDir, 'migrations');
    mkdirSync(migrations);
    writeFileSync(join(migrations, '0001_a.sql'), 'CREATE TABLE marker (id INTEGER PRIMARY KEY);\n');
    await runMigrations(db, { dir: migrations, clock: fixedClock(T) });
    writeFileSync(join(migrations, '0002_b.sql'), 'CREATE TABLE after_backup (id INTEGER PRIMARY KEY);\n');
    const absentBackup = join(missing.root, 'no-such-backup');
    await runMigrations(db, {
      dir: migrations,
      clock: fixedClock(T),
      backup: makePreMigrateBackup({
        db,
        config: config({ data_dir: missing.dataDir, backup_dir: absentBackup }),
        secrets: testSecrets(),
      }),
    });
    expect(existsSync(absentBackup)).toBe(false);
    expect(existsSync(join(missing.dataDir, 'pre-migrate-1-2.sqlite.enc'))).toBe(true);
    expect(existsSync(join(missing.dataDir, 'pre-migrate-1-2.sqlite'))).toBe(false);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    db.close();

    const locked = scratch(dirs);
    const lockedDb = openDb(join(locked.dataDir, 'hub.sqlite'));
    const lockedMigrations = join(locked.dataDir, 'migrations');
    mkdirSync(lockedMigrations);
    writeFileSync(join(lockedMigrations, '0001_a.sql'), 'CREATE TABLE marker (id INTEGER PRIMARY KEY);\n');
    await runMigrations(lockedDb, { dir: lockedMigrations, clock: fixedClock(T) });
    writeFileSync(join(lockedMigrations, '0002_b.sql'), 'CREATE TABLE after_backup (id INTEGER PRIMARY KEY);\n');
    chmodSync(locked.dataDir, 0o555);
    chmodSync(locked.backupDir, 0o555);
    await expect(
      runMigrations(lockedDb, {
        dir: lockedMigrations,
        clock: fixedClock(T),
        backup: makePreMigrateBackup({
          db: lockedDb,
          config: config({ data_dir: locked.dataDir, backup_dir: locked.backupDir }),
          secrets: testSecrets(),
        }),
      }),
    ).rejects.toThrow();
    expect(lockedDb.pragma('user_version', { simple: true })).toBe(1);
    expect(lockedDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'after_backup'").get()).toBeUndefined();
    expect(readdirSync(locked.dataDir).some((name) => name.startsWith('pre-migrate-'))).toBe(false);
    chmodSync(locked.dataDir, 0o755);
    chmodSync(locked.backupDir, 0o755);
    lockedDb.close();
  });

  it('[00 §10 #111] a leftover pre-migrate-*.sqlite is deleted, .enc kept', () => {
    const { dataDir } = scratch(dirs);
    writeFileSync(join(dataDir, 'pre-migrate-1-2.sqlite'), 'plain');
    writeFileSync(join(dataDir, 'pre-migrate-1-2.sqlite.enc'), 'cipher');
    writeFileSync(join(dataDir, 'hub.sqlite'), 'live');
    const removed = deleteLeftoverPlaintext(dataDir);
    expect(removed).toEqual([join(dataDir, 'pre-migrate-1-2.sqlite')]);
    expect(existsSync(join(dataDir, 'pre-migrate-1-2.sqlite'))).toBe(false);
    expect(existsSync(join(dataDir, 'pre-migrate-1-2.sqlite.enc'))).toBe(true);
    expect(existsSync(join(dataDir, 'hub.sqlite'))).toBe(true);
  });

  it('[00 §3.8] unprovisioned → no backup file, migrations still run', async () => {
    const { dataDir, backupDir } = scratch(dirs);
    const db = openDb(join(dataDir, 'hub.sqlite'));
    const migrations = join(dataDir, 'migrations');
    mkdirSync(migrations);
    writeFileSync(join(migrations, '0001_a.sql'), 'CREATE TABLE marker (id INTEGER PRIMARY KEY);\n');
    await runMigrations(db, { dir: migrations, clock: fixedClock(T) });
    writeFileSync(join(migrations, '0002_b.sql'), 'CREATE TABLE after_backup (id INTEGER PRIMARY KEY);\n');
    const cfg = config({ data_dir: dataDir, backup_dir: backupDir, provisioned: false });
    await runMigrations(db, {
      dir: migrations,
      clock: fixedClock(T),
      backup: makePreMigrateBackup({ db, config: cfg, secrets: testSecrets() }),
    });
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(readdirSync(dataDir).some((name) => name.startsWith('pre-migrate-'))).toBe(false);
    expect(readdirSync(backupDir).some((name) => name.startsWith('pre-migrate-'))).toBe(false);
    db.close();
  });
});

function scratch(dirs: string[]): { root: string; dataDir: string; backupDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'pos-backup-'));
  dirs.push(root);
  const dataDir = join(root, 'data');
  const backupDir = join(root, 'backup');
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  return { root, dataDir, backupDir };
}

function config(over: { data_dir: string; backup_dir: string; provisioned?: boolean }): HubConfig {
  return HubConfigSchema.parse({
    cloud_base_url: 'https://api.example-pos.app/v1',
    http_port: 3000,
    data_dir: over.data_dir,
    backup_dir: over.backup_dir,
    min_client_version: '1.0.0',
    backup_encryption_key: KEY.toString('base64'),
    ...(over.provisioned === false
      ? {}
      : {
          provisioned: {
            tenant_id: '01J00000000000000000000000',
            branch_id: '01J00000000000000000000001',
            branch_api_key: 'branch-key',
          },
        }),
  });
}
