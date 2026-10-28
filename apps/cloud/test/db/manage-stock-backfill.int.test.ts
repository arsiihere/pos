import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { testIdGen } from '../../src/lib/ids';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

const backfill = fileURLToPath(new URL('../../src/db/migrations/0003_manage_stock_backfill.sql', import.meta.url));

describe('manage-stock backfill for tenants seeded before 01a', () => {
  const ids = testIdGen();
  let cloud: TestCloud;

  beforeAll(async () => {
    cloud = await createTestCloud();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    await truncateAll(cloud.pool);
  });

  async function seeded(email: string): Promise<string> {
    const { tenant_id } = await seedTenant(
      new SystemContext(cloud.pool),
      { name: 'Pilot', currency: 'PKR', ownerEmail: email, ownerName: 'Ada', password: 'password-1', pin: '1234' },
      { clock: cloud.clock, ids },
    );
    return tenant_id;
  }

  async function grants(tenantId: string): Promise<string[]> {
    const { rows } = await cloud.pool.query<{ name: string; grant_type: string }>(
      `SELECT r.name, rp.grant_type FROM role_permissions rp
         JOIN roles r ON r.tenant_id = rp.tenant_id AND r.role_id = rp.role_id
        WHERE rp.tenant_id = $1 AND rp.permission = 'manage-stock' ORDER BY r.name`,
      [tenantId],
    );
    return rows.map((row) => `${row.name}:${row.grant_type}`);
  }

  async function directoryVersion(tenantId: string): Promise<number> {
    const { rows } = await cloud.pool.query<{ directory_version: string }>(
      `SELECT directory_version FROM tenants WHERE tenant_id = $1`,
      [tenantId],
    );
    return Number(rows[0]!.directory_version);
  }

  it('[01a S18] 0003 grants manage-stock to existing Owner and Manager roles once, bumps directory_version once, and is idempotent', async () => {
    const old = await seeded('old@example.com');
    const fresh = await seeded('fresh@example.com');
    // A tenant seeded before task 4: its default roles have no manage-stock row.
    await cloud.pool.query(`DELETE FROM role_permissions WHERE tenant_id = $1 AND permission = 'manage-stock'`, [old]);
    const oldBefore = await directoryVersion(old);
    const freshBefore = await directoryVersion(fresh);

    const sql = readFileSync(backfill, 'utf8');
    await cloud.pool.query(sql);

    expect(await grants(old)).toEqual(['Manager:allowed', 'Owner:allowed']);
    expect(await directoryVersion(old)).toBe(oldBefore + 1);
    // Already granted: nothing inserted, no bump, so its hubs re-download nothing.
    expect(await grants(fresh)).toEqual(['Manager:allowed', 'Owner:allowed']);
    expect(await directoryVersion(fresh)).toBe(freshBefore);

    await cloud.pool.query(sql);
    expect(await grants(old)).toEqual(['Manager:allowed', 'Owner:allowed']);
    expect(await directoryVersion(old)).toBe(oldBefore + 1);
  });

  it('[01a S18] the migrator has applied 0003', async () => {
    const { rows } = await cloud.pool.query<{ name: string }>(`SELECT name FROM schema_migrations ORDER BY version`);
    expect(rows.map((row) => row.name)).toContain('0003_manage_stock_backfill.sql');
  });
});
