import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

// 01b v1.7 B-3, §5.2: role_permissions is rebuilt with 'my_zones' in its scope CHECK; rows, the approvers table
// and its foreign key survive.
describe('hub migration 0011_scope_my_zones', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[02p U-4] a role_permissions row with scope my_zones inserts after the expand migration', async () => {
    const { db, result } = await from0010();
    expect(result).toEqual({ from: 10, to: 11, applied: ['0011_scope_my_zones.sql'] });
    db.prepare("INSERT INTO role_permissions (role_id, permission, grant_type, scope) VALUES ('R_Z', 'manage-zone-stock', 'allowed', 'my_zones')").run();
    expect(() =>
      db.prepare("INSERT INTO role_permissions (role_id, permission, grant_type, scope) VALUES ('R_Z', 'take-order', 'allowed', 'my_tables')").run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.prepare("INSERT INTO role_permissions (role_id, permission, grant_type, scope) VALUES ('R_Z', 'void-item', 'maybe', 'branch')").run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('[02p U-4] keeps every row, the columns and key, and the approvers foreign key', async () => {
    const { db } = await from0010();
    expect(db.prepare('SELECT role_id, permission, grant_type, scope FROM role_permissions ORDER BY role_id, permission').all()).toEqual([
      { role_id: 'R_MGR', permission: 'apply-discount', grant_type: 'allowed', scope: 'branch' },
      { role_id: 'R_Z', permission: 'manage-stock', grant_type: 'allowed', scope: 'my_stations' },
      { role_id: 'R_Z', permission: 'void-item', grant_type: 'requires_approval', scope: 'my_floors' },
    ]);
    expect(db.prepare('SELECT role_id, permission, approver_role_id FROM role_permission_approvers').all()).toEqual([
      { role_id: 'R_Z', permission: 'void-item', approver_role_id: 'R_MGR' },
    ]);
    const cols = db.pragma('table_info(role_permissions)') as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
    expect(cols.map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk])).toEqual([
      ['role_id', 'TEXT', 1, null, 1],
      ['permission', 'TEXT', 1, null, 2],
      ['grant_type', 'TEXT', 1, null, 0],
      ['scope', 'TEXT', 1, "'branch'", 0],
    ]);
    const fks = db.pragma('foreign_key_list(role_permission_approvers)') as Array<{ table: string }>;
    expect([...new Set(fks.map((fk) => fk.table))].sort()).toEqual(['role_permissions', 'roles']);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    // The approvers foreign key still bites: no approver row for a grant that does not exist.
    expect(() => db.prepare("INSERT INTO role_permission_approvers (role_id, permission, approver_role_id) VALUES ('R_Z', 'nope', 'R_MGR')").run()).toThrow(/FOREIGN KEY/);
    // The role foreign key still bites.
    expect(() => db.prepare("INSERT INTO role_permissions (role_id, permission, grant_type, scope) VALUES ('R_NONE', 'x', 'allowed', 'branch')").run()).toThrow(/FOREIGN KEY/);
  });

  async function from0010(): Promise<{ db: Database.Database; result: Awaited<ReturnType<typeof runMigrations>> }> {
    const handle = freshDb();
    cleanups.push(handle.cleanup);
    const { db, dir } = handle;
    await runMigrations(db, { dir: copyUpTo(dir, '0010'), clock: fixedClock(T) });
    expect(db.pragma('user_version', { simple: true })).toBe(10);
    db.exec(`
      INSERT INTO roles (role_id, branch_id, name, session_idle_ttl_ms) VALUES ('R_MGR','b1','Manager',1000), ('R_Z','b1','Z',1000);
      INSERT INTO role_permissions (role_id, permission, grant_type, scope) VALUES
        ('R_MGR','apply-discount','allowed','branch'),
        ('R_Z','manage-stock','allowed','my_stations'),
        ('R_Z','void-item','requires_approval','my_floors');
      INSERT INTO role_permission_approvers (role_id, permission, approver_role_id) VALUES ('R_Z','void-item','R_MGR');`);
    expect(() =>
      db.prepare("INSERT INTO role_permissions (role_id, permission, grant_type, scope) VALUES ('R_Z', 'manage-zone-stock', 'allowed', 'my_zones')").run(),
    ).toThrow(/CHECK constraint failed/);
    const result = await runMigrations(db, { dir: copyUpTo(dir, '0011'), clock: fixedClock(T) });
    return { db, result };
  }
});

function copyUpTo(parent: string, last: string): string {
  const target = join(parent, `migrations-${last}`);
  mkdirSync(target);
  for (const name of readdirSync(migrations)) {
    if (name.endsWith('.sql') && name.slice(0, 4) <= last) copyFileSync(join(migrations, name), join(target, name));
  }
  return target;
}
