/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { restoreBump, runRestoreBump } from '../../src/cli/restore-bump';
import { SystemContext } from '../../src/cli/system-context';
import { restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

describe('restore-bump', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let out: string[];
  let errors: string[];

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    out = [];
    errors = [];
  });

  const run = (...argv: string[]) =>
    runRestoreBump(argv, {
      sys: new SystemContext(cloud.pool),
      clock: cloud.clock,
      out: (line) => out.push(line),
      err: (line) => errors.push(line),
    });
  const setVersions = async (config: number, directory: number) => {
    await cloud.pool.query(`UPDATE branches SET config_version = $2 WHERE tenant_id = $1`, [f.tenantId, config]);
    await cloud.pool.query(`UPDATE tenants SET directory_version = $2 WHERE tenant_id = $1`, [f.tenantId, directory]);
  };
  const state = async () => ({
    branches: (
      await cloud.pool.query<{ tenant_id: string; branch_id: string; config_version: string }>(
        `SELECT tenant_id, branch_id, config_version FROM branches ORDER BY branch_id`,
      )
    ).rows.map((row) => ({ ...row, config_version: Number(row.config_version) })),
    tenants: (
      await cloud.pool.query<{ tenant_id: string; directory_version: string }>(
        `SELECT tenant_id, directory_version FROM tenants ORDER BY tenant_id`,
      )
    ).rows.map((row) => ({ ...row, directory_version: Number(row.directory_version) })),
    audit: Number((await cloud.pool.query<{ n: string }>(`SELECT count(*) AS n FROM config_audit`)).rows[0]!.n),
  });

  it('[01a §10 #123] cloud part: after a restore to 40 / 30, restore-bump raises every branch and the directory to ≥ now and > the old values, no audit row; again later raises them again; unknown tenant → exit 1, nothing written; SystemContext only (M56)', async () => {
    await setVersions(50, 35); // what the hub has applied
    await setVersions(40, 30); // an older dump restored
    const before = await state();
    const otherTenant = (s: Awaited<ReturnType<typeof state>>) => ({
      branches: s.branches.filter((b) => b.tenant_id !== f.tenantId),
      tenants: s.tenants.filter((t) => t.tenant_id !== f.tenantId),
    });

    const now = cloud.clock.branchNow();
    expect(await run('--tenant', f.tenantId)).toBe(0);
    const after = await state();
    const mine = after.branches.filter((b) => b.tenant_id === f.tenantId);
    expect(mine.map((b) => b.branch_id).sort()).toEqual([...f.branches].sort());
    for (const branch of mine) {
      expect(branch.config_version).toBeGreaterThanOrEqual(now);
      expect(branch.config_version).toBeGreaterThan(50);
    }
    const directory = after.tenants.find((t) => t.tenant_id === f.tenantId)!.directory_version;
    expect(directory).toBeGreaterThanOrEqual(now);
    expect(directory).toBeGreaterThan(35);
    expect(after.audit).toBe(before.audit);
    expect(otherTenant(after)).toEqual(otherTenant(before));
    const printed = out.join('\n');
    for (const branchId of f.branches) expect(printed).toContain(`${branchId}: 40 → ${now}`);
    expect(printed).toContain(`directory: 30 → ${now}`);

    // Later, a second run raises them again (same clock: + 1; a later clock: to the new now).
    expect(await run('--tenant', f.tenantId)).toBe(0);
    const again = await state();
    for (const branch of again.branches.filter((b) => b.tenant_id === f.tenantId)) expect(branch.config_version).toBe(now + 1);
    cloud.clock.set(now + 60_000);
    const result = await restoreBump(new SystemContext(cloud.pool), { tenantId: f.tenantId }, { clock: cloud.clock });
    expect(result.branches.map((b) => [b.before, b.after])).toEqual(f.branches.map(() => [now + 1, now + 60_000]));
    expect(result.directory).toEqual({ before: now + 1, after: now + 60_000 });
    cloud.clock.set(now);

    const unchanged = await state();
    expect(await run('--tenant', 'NO-SUCH-TENANT')).toBe(1);
    expect(errors.join('\n')).toMatch(/unknown tenant/);
    expect(await run()).toBe(1);
    expect(await run('--tenant', f.tenantId, '--extra', 'x')).toBe(1);
    expect(await state()).toEqual(unchanged);

    // M56: SystemContext may be imported only under apps/cloud/src/cli/.
    const eslint = new ESLint({ cwd: root });
    const code = "import { SystemContext } from '../cli/system-context.js';\nexport const S = SystemContext;\n";
    const lint = async (relPath: string) =>
      ((await eslint.lintText(code, { filePath: root + relPath }))[0]?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.message);
    expect(await lint('apps/cloud/src/modules/x.ts')).toEqual([expect.stringContaining('M56')]);
    expect(await lint('apps/cloud/src/cli/x.ts')).toEqual([]);
  }, 60_000);
});
