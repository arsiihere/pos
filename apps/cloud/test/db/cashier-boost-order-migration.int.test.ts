import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 01b v1.13 (owner 2026-11-28 Q7): a scratch database migrated to 0023 (the predecessor of 0024) with tenants seeded before
// the Cashier default gained boost-order, then the real folder (with 0024_cashier_boost_order.sql).

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;

let pool: pg.Pool;
let before: Record<string, number> = {};
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);

async function role(tenant: string, roleId: string, name: string, key: string | null, archived: number | null = null): Promise<void> {
  await q(`INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms, default_key, archived_at) VALUES ($1, $2, $3, 900000, $4, $5)`, [tenant, roleId, name, key, archived]);
}
async function grant(tenant: string, roleId: string, permission: string, grantType: string, approver: string | null, scope: string): Promise<void> {
  await q(`INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id, scope) VALUES ($1, $2, $3, $4, $5, $6)`, [tenant, roleId, permission, grantType, approver, scope]);
}
async function versions(): Promise<Record<string, number>> {
  const { rows } = await q(`SELECT tenant_id, directory_version FROM tenants ORDER BY tenant_id`);
  return Object.fromEntries(rows.map((r) => [r.tenant_id, Number(r.directory_version)]));
}
async function boost(): Promise<unknown[]> {
  return (await q(`SELECT tenant_id, role_id, grant_type, approver_role_id, scope FROM role_permissions WHERE permission = 'boost-order' ORDER BY tenant_id, role_id`)).rows;
}

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(23));
  for (const t of ['tA', 'tB', 'tC']) await q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, $1, 'PKR', $2)`, [t, T]);
  // tA: an active default cashier (renamed) without boost-order; the order taker already has it
  await role('tA', 'rA-man', 'Manager', 'manager');
  await role('tA', 'rA-cash', 'Till', 'cashier');
  await role('tA', 'rA-ot', 'Order taker', 'order_taker');
  await grant('tA', 'rA-ot', 'boost-order', 'allowed', null, 'branch');
  // tB: the owner already set the cashier's boost-order (requires approval) — kept
  await role('tB', 'rB-man', 'Manager', 'manager');
  await role('tB', 'rB-cash', 'Cashier', 'cashier');
  await grant('tB', 'rB-cash', 'boost-order', 'requires_approval', 'rB-man', 'branch');
  // tC: the default cashier is archived; a custom "Cashier" has no default_key — neither changes
  await role('tC', 'rC-cash-old', 'Cashier', 'cashier', T);
  await role('tC', 'rC-custom', 'Cashier', null);
  before = await versions();
  await migrate(pool, migrationsDir, fixedClock(T));
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

describe('[01b v1.13 owner 2026-11-28 Q7] cloud migration 0024_cashier_boost_order.sql', () => {
  it("an existing tenant's active default cashier gets boost-order allowed at branch; an owner's own grant is kept; archived / custom roles untouched", async () => {
    expect(await boost()).toEqual([
      { tenant_id: 'tA', role_id: 'rA-cash', grant_type: 'allowed', approver_role_id: null, scope: 'branch' },
      { tenant_id: 'tA', role_id: 'rA-ot', grant_type: 'allowed', approver_role_id: null, scope: 'branch' },
      { tenant_id: 'tB', role_id: 'rB-cash', grant_type: 'requires_approval', approver_role_id: 'rB-man', scope: 'branch' },
    ]);
  });

  it('directory_version +1 only for a tenant that gained a row', async () => {
    const after = await versions();
    expect(after['tA']).toBe(before['tA']! + 1);
    expect(after['tB']).toBe(before['tB']);
    expect(after['tC']).toBe(before['tC']);
  });
});
