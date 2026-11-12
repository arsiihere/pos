import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01b v1.8.1 §6.15 (owner Q-23, Q-34): a scratch database migrated to 0014 with tenants seeded before the Cashier
// default gained mark-served, then the real folder (with 0015_cashier_mark_served.sql).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const backfill = fileURLToPath(new URL('../../src/db/migrations/0015_cashier_mark_served.sql', import.meta.url));
const T = 1_761_000_000_000;

let pool: pg.Pool;
let before: Record<string, number> = {};
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);

async function role(tenant: string, roleId: string, name: string, key: string | null, archived: number | null = null): Promise<void> {
  await q(
    `INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms, default_key, archived_at) VALUES ($1, $2, $3, 900000, $4, $5)`,
    [tenant, roleId, name, key, archived],
  );
}
async function grant(tenant: string, roleId: string, permission: string, grantType: string, approver: string | null, scope: string): Promise<void> {
  await q(
    `INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope) VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenant, roleId, permission, grantType, approver, scope],
  );
}
async function versions(): Promise<Record<string, number>> {
  const { rows } = await q(`SELECT tenant_id, directory_version FROM tenants ORDER BY tenant_id`);
  return Object.fromEntries(rows.map((r) => [r.tenant_id, Number(r.directory_version)]));
}
async function markServed(): Promise<unknown[]> {
  const { rows } = await q(
    `SELECT tenant_id, role_id, grant_type, approver_role_id, scope FROM role_permissions WHERE permission = 'mark-served' ORDER BY tenant_id, role_id`,
  );
  return rows;
}
async function allGrants(): Promise<unknown[]> {
  return (await q(`SELECT * FROM role_permissions ORDER BY tenant_id, role_id, permission`)).rows;
}

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(14));
  for (const t of ['tA', 'tB', 'tC']) {
    await q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, $1, 'PKR', $2)`, [t, T]);
  }
  // tA: an active default cashier without mark-served, plus an order taker that already has it.
  await role('tA', 'rA-man', 'Manager', 'manager');
  await role('tA', 'rA-cash', 'Till', 'cashier'); // renamed: found by default_key, not by name
  await role('tA', 'rA-ot', 'Order taker', 'order_taker');
  await grant('tA', 'rA-cash', 'take-order', 'allowed', null, 'branch');
  await grant('tA', 'rA-ot', 'mark-served', 'allowed', null, 'branch');
  // tB: the cashier already holds mark-served as the owner set it (requires approval, own_tables).
  await role('tB', 'rB-man', 'Manager', 'manager');
  await role('tB', 'rB-cash', 'Cashier', 'cashier');
  await grant('tB', 'rB-cash', 'mark-served', 'requires_approval', 'rB-man', 'own_tables');
  // tC: the default cashier is archived; an active custom role named "Cashier" has no default_key.
  await role('tC', 'rC-cash-old', 'Cashier', 'cashier', T);
  await role('tC', 'rC-custom', 'Cashier', null);
  before = await versions();
  await migrate(pool, migrationsDir, fixedClock(T));
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

describe('[01b v1.8.1 §6.15] cloud migration 0015_cashier_mark_served.sql', () => {
  it("[01b v1.8.1 Q-34] 0015: an existing tenant's active cashier role gets mark-served allowed at branch; directory_version +1 once", async () => {
    expect((await markServed()).filter((r) => (r as { tenant_id: string }).tenant_id === 'tA')).toEqual([
      { tenant_id: 'tA', role_id: 'rA-cash', grant_type: 'allowed', approver_role_id: null, scope: 'branch' },
      { tenant_id: 'tA', role_id: 'rA-ot', grant_type: 'allowed', approver_role_id: null, scope: 'branch' },
    ]);
    expect((await versions()).tA).toBe(before.tA! + 1);
    // only mark-served: no boost-order, no other role touched
    expect((await q(`SELECT count(*)::int AS n FROM role_permissions WHERE permission = 'boost-order'`)).rows[0]).toEqual({ n: 0 });
    expect((await q(`SELECT count(*)::int AS n FROM role_permissions WHERE role_id = 'rA-man'`)).rows[0]).toEqual({ n: 0 });
    // a migration is not an owner write
    expect((await q(`SELECT count(*)::int AS n FROM config_audit`)).rows[0]).toEqual({ n: 0 });
  });

  it('[01b v1.8.1 Q-34] an existing mark-served grant (any grant_type / scope) is kept; an archived cashier role is skipped; a second run changes nothing and bumps nothing', async () => {
    const rows = await markServed();
    expect(rows.filter((r) => (r as { tenant_id: string }).tenant_id !== 'tA')).toEqual([
      { tenant_id: 'tB', role_id: 'rB-cash', grant_type: 'requires_approval', approver_role_id: 'rB-man', scope: 'own_tables' },
    ]);
    const after = await versions();
    expect(after.tB).toBe(before.tB);
    expect(after.tC).toBe(before.tC); // archived default cashier and the key-less "Cashier" both skipped

    const grantsBefore = await allGrants();
    await q(readFileSync(backfill, 'utf8'));
    expect(await allGrants()).toEqual(grantsBefore);
    expect(await versions()).toEqual(after);
  });
});
