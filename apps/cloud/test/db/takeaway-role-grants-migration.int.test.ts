import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01b v1.12 §5.1c (B-4, B-5; owner review OR-2, OR-7), tests 118 and 119 (cloud parts): scratch databases migrated to
// 0021 with tenants seeded before the Pass role and hand-over-unpaid existed, then the real folder (with
// 0022_takeaway_role_grants.sql).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const backfillSql = readFileSync(fileURLToPath(new URL('../../src/db/migrations/0022_takeaway_role_grants.sql', import.meta.url)), 'utf8');
const T = 1_761_000_000_000;

type Q = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;
type Row = Record<string, unknown>;

const tenant = (q: Q, id: string) => q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, $1, 'PKR', $2)`, [id, T]);
const role = (q: Q, t: string, roleId: string, name: string, key: string | null, archived: number | null = null) =>
  q(`INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms, default_key, archived_at) VALUES ($1, $2, $3, 900000, $4, $5)`, [t, roleId, name, key, archived]);
const grant = (q: Q, t: string, roleId: string, permission: string) =>
  q(`INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope) VALUES ($1, $2, $3, 'allowed', NULL, 'branch')`, [t, roleId, permission]);
async function versions(q: Q): Promise<Record<string, number>> {
  const { rows } = await q(`SELECT tenant_id, directory_version FROM tenants ORDER BY tenant_id`);
  return Object.fromEntries(rows.map((r: { tenant_id: string; directory_version: string }) => [r.tenant_id, Number(r.directory_version)]));
}
async function grantRows(q: Q): Promise<Row[]> {
  return (await q(`SELECT tenant_id, role_id, permission, grant_type, approver_role_id, scope FROM role_permissions ORDER BY tenant_id, role_id, permission`)).rows;
}
async function passRoles(q: Q): Promise<Row[]> {
  return (await q(`SELECT tenant_id, role_id, name, session_idle_ttl_ms, archived_at FROM roles WHERE default_key = 'pass' ORDER BY tenant_id`)).rows;
}
const key = (r: Row): string => `${String(r.tenant_id)}|${String(r.role_id)}|${String(r.permission)}`;

describe('[01b v1.12 §5.1c] cloud migration 0022_takeaway_role_grants.sql', () => {
  let pool: pg.Pool;
  const q: Q = (sql, params = []) => pool.query(sql, params);
  let before: Record<string, number> = {};
  let grantsBefore: Row[] = [];

  beforeAll(async () => {
    ({ pool } = await scratchDatabaseAt(21));
    for (const t of ['tA', 'tB', 'tC']) await tenant(q, t);
    // tA: owner, manager, cook and a renamed cashier with their grants; no Pass role, no hand-over-unpaid.
    await role(q, 'tA', 'rA-own', 'Owner', 'owner');
    await role(q, 'tA', 'rA-man', 'Manager', 'manager');
    await role(q, 'tA', 'rA-cook', 'Cook', 'cook');
    await role(q, 'tA', 'rA-cash', 'Till', 'cashier');
    await grant(q, 'tA', 'rA-own', 'void-item');
    await grant(q, 'tA', 'rA-man', 'void-item');
    await grant(q, 'tA', 'rA-cook', 'run-pass');
    await grant(q, 'tA', 'rA-cook', 'reprint-ticket');
    await grant(q, 'tA', 'rA-cash', 'take-order');
    // tB: Owner and Manager already hold hand-over-unpaid (set by hand) → only the Pass role is added.
    await role(q, 'tB', 'rB-own', 'Owner', 'owner');
    await role(q, 'tB', 'rB-man', 'Manager', 'manager');
    await grant(q, 'tB', 'rB-own', 'hand-over-unpaid');
    await grant(q, 'tB', 'rB-man', 'hand-over-unpaid');
    // tC: an active custom role named "PASS" (case-insensitive match) → the new role is "Pass point"; its default
    // manager is archived (skipped); an archived role named "Pass point" does not count.
    await role(q, 'tC', 'rC-own', 'Owner', 'owner');
    await role(q, 'tC', 'rC-man-old', 'Manager', 'manager', T);
    await role(q, 'tC', 'rC-custom', 'PASS', null);
    await role(q, 'tC', 'rC-old-pp', 'Pass point', null, T);
    before = await versions(q);
    grantsBefore = await grantRows(q);
    await migrate(pool, migrationsDir, fixedClock(T));
  }, 40_000);

  afterAll(async () => {
    await dropScratchDatabases();
  }, 40_000);

  it('[01b #118, #119] one Pass role (5 min; run-pass, mark-served, reprint-ticket allowed at branch) per tenant; "Pass point" beside an active "pass"; Owner and active Manager gain hand-over-unpaid; one bump per tenant for the whole file; every other row unchanged', async () => {
    const roles = await passRoles(q);
    expect(roles.map((r) => [r.tenant_id, r.name, r.session_idle_ttl_ms, r.archived_at])).toEqual([
      ['tA', 'Pass', 300_000, null],
      ['tB', 'Pass', 300_000, null],
      ['tC', 'Pass point', 300_000, null],
    ]);
    const passIds = new Set(roles.map((r) => String(r.role_id)));
    const after = await grantRows(q);
    for (const r of roles) {
      expect(after.filter((g) => g.role_id === r.role_id).map((g) => [g.permission, g.grant_type, g.approver_role_id, g.scope])).toEqual([
        ['mark-served', 'allowed', null, 'branch'],
        ['reprint-ticket', 'allowed', null, 'branch'],
        ['run-pass', 'allowed', null, 'branch'],
      ]);
    }
    const hou = after.filter((g) => g.permission === 'hand-over-unpaid').map((g) => [g.tenant_id, g.role_id, g.grant_type, g.approver_role_id, g.scope]);
    expect(hou).toEqual([
      ['tA', 'rA-man', 'allowed', null, 'branch'],
      ['tA', 'rA-own', 'allowed', null, 'branch'],
      ['tB', 'rB-man', 'allowed', null, 'branch'],
      ['tB', 'rB-own', 'allowed', null, 'branch'],
      ['tC', 'rC-own', 'allowed', null, 'branch'], // rC-man-old is archived: skipped
    ]);
    // Every row that existed before is unchanged; the only new rows are the Pass grants and the hand-over-unpaid rows.
    const was = new Map(grantsBefore.map((g) => [key(g), g]));
    for (const g of grantsBefore) expect(after.find((a) => key(a) === key(g)), key(g)).toEqual(g);
    const added = after.filter((g) => !was.has(key(g)));
    // ⚠️ 01b v1.13 (owner 2026-11-28 Q7): the same run also has 0024's boost-order on tA's active default cashier
    for (const g of added) expect(passIds.has(String(g.role_id)) || g.permission === 'hand-over-unpaid' || (g.role_id === 'rA-cash' && g.permission === 'boost-order'), key(g)).toBe(true);
    expect(added).toHaveLength(3 * 3 + 3 + 1);
    // Cook keeps exactly run-pass + reprint-ticket.
    expect(after.filter((g) => g.role_id === 'rA-cook').map((g) => g.permission)).toEqual(['reprint-ticket', 'run-pass']);
    // +1 for the whole file, also where the same run adds Owner's and Manager's rows (tA); a migration writes no audit.
    // ⚠️ 01b v1.13 Q7: tA + 1 more by 0024 (its cashier gained boost-order)
    expect(await versions(q)).toEqual({ tA: before.tA! + 2, tB: before.tB! + 1, tC: before.tC! + 1 });
    expect((await q(`SELECT count(*)::int AS n FROM config_audit`)).rows[0]).toEqual({ n: 0 });
  });

  it('[01b #118, #119 R3-m-2] re-executing the SQL outside the runner writes nothing and bumps nothing; a tenant that already has a Pass role and both rows is left alone', async () => {
    await tenant(q, 'tD');
    await role(q, 'tD', 'rD-own', 'Owner', 'owner');
    await role(q, 'tD', 'rD-man', 'Manager', 'manager');
    await role(q, 'tD', 'rD-pass', 'Pass', 'pass');
    for (const p of ['run-pass', 'mark-served', 'reprint-ticket']) await grant(q, 'tD', 'rD-pass', p);
    await grant(q, 'tD', 'rD-own', 'hand-over-unpaid');
    await grant(q, 'tD', 'rD-man', 'hand-over-unpaid');
    const grants = await grantRows(q);
    const roles = await passRoles(q);
    const v = await versions(q);
    await q(backfillSql);
    expect(await grantRows(q)).toEqual(grants);
    expect(await passRoles(q)).toEqual(roles);
    expect(await versions(q)).toEqual(v);
  });

  it('[01b #118] the widened CHECK accepts pass and still refuses an unknown key; one Pass role per tenant', async () => {
    const def = (await q(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'roles_default_key_check'`)).rows[0]!.def as string;
    expect(def).toContain("'pass'");
    await tenant(q, 'tE');
    await expect(role(q, 'tE', 'rE-x', 'Expo', 'expo')).rejects.toThrow(/roles_default_key_check/);
    await role(q, 'tE', 'rE-pass', 'Pass', 'pass');
    await expect(role(q, 'tE', 'rE-pass2', 'Pass 2', 'pass')).rejects.toThrow(/roles_default_key/);
  });
});

describe('[01b #118] the 0022 guard: active roles named both "Pass" and "Pass point"', () => {
  let pool: pg.Pool;
  const q: Q = (sql, params = []) => pool.query(sql, params);

  beforeAll(async () => {
    ({ pool } = await scratchDatabaseAt(21));
    await tenant(q, 'tOK');
    await role(q, 'tOK', 'rOK-own', 'Owner', 'owner');
    await tenant(q, 'tX');
    await role(q, 'tX', 'rX-own', 'Owner', 'owner');
    await role(q, 'tX', 'rX-p', 'pass', null);
    await role(q, 'tX', 'rX-pp', 'PASS POINT', null);
  }, 40_000);

  afterAll(async () => {
    await dropScratchDatabases();
  }, 40_000);

  it('aborts with the guard message naming the tenant; nothing applied (no role, grant, bump, CHECK change or schema_migrations row)', async () => {
    const v = await versions(q);
    const grants = await grantRows(q);
    await expect(migrate(pool, migrationsDir, fixedClock(T))).rejects.toThrow(/takeaway_role_grants: tenants tX have active roles named both "Pass" and "Pass point"/);
    expect(await passRoles(q)).toEqual([]);
    expect(await grantRows(q)).toEqual(grants);
    expect(await versions(q)).toEqual(v);
    const def = (await q(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'roles_default_key_check'`)).rows[0]!.def as string;
    expect(def).not.toContain("'pass'");
    expect((await q(`SELECT count(*)::int AS n FROM schema_migrations WHERE version = 22`)).rows[0]).toEqual({ n: 0 });
  });
});
