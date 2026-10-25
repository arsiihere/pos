import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issueRegistrationCode } from '../../src/cli/issue-registration-code';
import { seedTenant } from '../../src/cli/seed-tenant';
import { SystemContext } from '../../src/cli/system-context';
import { TenantLevelRepository } from '../../src/db/tenant-level-repository';
import { auditActionFor, writeConfigAudit } from '../../src/lib/config-audit';
import { bumpConfigVersion, coversEveryBranch } from '../../src/lib/config-version';
import { inTransaction } from '../../src/lib/idempotency';
import { testIdGen } from '../../src/lib/ids';
import { testSecrets } from '../../src/lib/secrets';
import { pgCounter } from '../helpers/pg-counter';
import { createTestCloud, truncateAll, type TestCloud } from '../helpers/test-cloud';

describe('config version and audit', () => {
  let cloud: TestCloud;
  let tenantId: string;
  let userId: string;
  let branches: string[];
  let otherBranch: string;

  beforeAll(async () => {
    cloud = await createTestCloud();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    await truncateAll(cloud.pool);
    const sys = new SystemContext(cloud.pool);
    const deps = { clock: cloud.clock, ids: testIdGen(), secrets: testSecrets() };
    const seed = (name: string, email: string) =>
      seedTenant(sys, { name, currency: 'PKR', ownerEmail: email, ownerName: 'Ada', password: 'password-1', pin: '1234' }, deps);
    const a = await seed('Tenant A', 'a@example.com');
    tenantId = a.tenant_id;
    userId = a.user_id;
    branches = [];
    for (const name of ['A', 'B', 'C']) {
      branches.push((await issueRegistrationCode(sys, { tenantId, branchName: name }, deps)).branch_id);
    }
    const b = await seed('Tenant B', 'b@example.com');
    otherBranch = (await issueRegistrationCode(sys, { tenantId: b.tenant_id, branchName: 'X' }, deps)).branch_id;
  });

  const tenant = () => Object.freeze({ tenantId, branchIds: Object.freeze([...branches]) });

  async function versions(): Promise<Record<string, number>> {
    const rows = await cloud.pool.query<{ branch_id: string; config_version: string }>(
      `SELECT branch_id, config_version FROM branches`,
    );
    return Object.fromEntries(rows.rows.map((row) => [row.branch_id, Number(row.config_version)]));
  }

  it('[01a §10 #8] 10 concurrent config writes on one branch raise config_version by exactly 10', async () => {
    const before = await versions();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        inTransaction(cloud.pool, (client) =>
          bumpConfigVersion(new TenantLevelRepository(tenant(), client), { kind: 'branch', branchId: branches[0]! }),
        ),
      ),
    );
    const after = await versions();
    expect(after[branches[0]!]).toBe(before[branches[0]!]! + 10);
    expect(after[branches[1]!]).toBe(before[branches[1]!]);
    expect(results.map((r) => r[0]!.config_version).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 10 }, (_, i) => before[branches[0]!]! + 1 + i),
    );
  });

  it('[01a S8] tenant scope bumps all 3 branches', async () => {
    const before = await versions();
    const rows = await inTransaction(cloud.pool, (client) =>
      bumpConfigVersion(new TenantLevelRepository(tenant(), client), { kind: 'tenant', ownerUserId: userId }),
    );
    const after = await versions();
    expect(rows).toEqual(
      [...branches].sort().map((branchId) => ({ branch_id: branchId, config_version: before[branchId]! + 1 })),
    );
    expect(after[otherBranch]).toBe(before[otherBranch]);
  });

  it('[01a S8] coversEveryBranch true for an owner row with A, B, C; false after removing C from the row by SQL; one statement', async () => {
    const counter = pgCounter(cloud.pool);
    const db = new TenantLevelRepository(tenant(), cloud.pool);
    counter.reset();
    expect(await coversEveryBranch(db, userId)).toBe(true);
    expect(counter.count).toBe(1);
    await cloud.pool.query(
      `UPDATE owner_users SET allowed_branch_ids = array_remove(allowed_branch_ids, $3) WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId, branches[2]],
    );
    counter.reset();
    expect(await coversEveryBranch(db, userId)).toBe(false);
    expect(counter.count).toBe(1);
  });

  it('[01a S8] tenant scope reads the owner row: a row missing C → PERMISSION_DENIED tenant_wide_write, nothing bumped; null (CLI) skips the check', async () => {
    await cloud.pool.query(
      `UPDATE owner_users SET allowed_branch_ids = array_remove(allowed_branch_ids, $3) WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId, branches[2]],
    );
    const before = await versions();
    const bump = (ownerUserId: string | null) =>
      inTransaction(cloud.pool, (client) =>
        bumpConfigVersion(new TenantLevelRepository(tenant(), client), { kind: 'tenant', ownerUserId }),
      );
    await expect(bump(userId)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
    await expect(bump('NO-SUCH-OWNER')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(await versions()).toEqual(before);
    expect(await bump(null)).toHaveLength(3);
  });

  it('[01a S26] writeConfigAudit stores actor, entity, before/after; cli actor stores null user', async () => {
    const ids = testIdGen();
    await inTransaction(cloud.pool, async (client) => {
      const db = new TenantLevelRepository(tenant(), client);
      await writeConfigAudit(
        db,
        {
          actor: { kind: 'owner', ownerUserId: userId },
          entity: 'floor',
          entityId: 'F1',
          branchId: branches[0]!,
          action: 'update',
          before: { floor_id: 'F1', name: 'Ground' },
          after: { floor_id: 'F1', name: 'Upper' },
        },
        { clock: cloud.clock, ids },
      );
      await writeConfigAudit(
        db,
        {
          actor: { kind: 'cli' },
          entity: 'branch_settings',
          entityId: branches[1]!,
          branchId: branches[1]!,
          action: 'update',
          before: { tax_enabled: false },
          after: { tax_enabled: true },
        },
        { clock: cloud.clock, ids },
      );
    });
    const rows = await cloud.pool.query(
      `SELECT tenant_id, audit_id, actor_kind, actor_owner_user_id, branch_id, entity, entity_id, action, before, after, at
         FROM config_audit ORDER BY audit_id`,
    );
    const at = cloud.clock.branchNow();
    expect(rows.rows).toEqual([
      {
        tenant_id: tenantId,
        audit_id: expect.any(String),
        actor_kind: 'owner',
        actor_owner_user_id: userId,
        branch_id: branches[0],
        entity: 'floor',
        entity_id: 'F1',
        action: 'update',
        before: { floor_id: 'F1', name: 'Ground' },
        after: { floor_id: 'F1', name: 'Upper' },
        at: String(at),
      },
      {
        tenant_id: tenantId,
        audit_id: expect.any(String),
        actor_kind: 'cli',
        actor_owner_user_id: null,
        branch_id: branches[1],
        entity: 'branch_settings',
        entity_id: branches[1],
        action: 'update',
        before: { tax_enabled: false },
        after: { tax_enabled: true },
        at: String(at),
      },
    ]);
  });

  it('[01a S26] auditActionFor', () => {
    expect(auditActionFor({ archived_at: null }, { archived_at: null })).toBe('update');
    expect(auditActionFor({ archived_at: null }, { archived_at: 5 })).toBe('archive');
    expect(auditActionFor({ archived_at: 5 }, { archived_at: null })).toBe('restore');
    expect(auditActionFor({ archived_at: 5 }, { archived_at: 5 })).toBe('update');
  });
});
