/// <reference types="node" />
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/migrate.js';
import { systemClock, type Clock } from '../lib/clock.js';
import { loadCloudEnv } from '../lib/env.js';
import { ulidGen, type IdGen } from '../lib/ids.js';
import { cryptoSecrets, type SecretGen } from '../lib/secrets.js';
import { codeHash, generateCode } from './codes.js';
import { SystemContext } from './system-context.js';

const CODE_TTL_MS = 86_400_000;

export async function issueRegistrationCode(
  sys: SystemContext,
  input: { tenantId: string } & ({ branchName: string } | { branchId: string }),
  deps: { clock: Clock; ids: IdGen; secrets: SecretGen },
): Promise<{ code: string; branch_id: string; expires_at: number }> {
  const now = deps.clock.branchNow();
  const code = generateCode(deps.secrets);
  const expiresAt = now + CODE_TTL_MS;
  return sys.tx(async (ctx) => {
    // 01b B11: the tenant row first, as every directory write.
    const tenants = await ctx.query(`SELECT 1 FROM tenants WHERE tenant_id = $1 FOR NO KEY UPDATE`, [input.tenantId]);
    if (tenants.length === 0) throw new Error('tenant not found');
    const branchId = 'branchName' in input ? await createBranch(ctx, input.tenantId, input.branchName, now, deps.ids) : input.branchId;
    if (!('branchName' in input)) {
      const rows = await ctx.query<{ hub_confirmed_at: string | null }>(
        `SELECT hub_confirmed_at FROM branches WHERE tenant_id = $1 AND branch_id = $2 FOR UPDATE`,
        [input.tenantId, branchId],
      );
      const branch = rows[0];
      if (branch === undefined) throw new Error('branch not found');
      if (branch.hub_confirmed_at !== null) throw new Error('branch is confirmed');
      await ctx.query(
        `UPDATE registration_codes SET expires_at = $3
          WHERE tenant_id = $1 AND branch_id = $2 AND consumed_at IS NULL AND expires_at > $3`,
        [input.tenantId, branchId, now],
      );
    }
    await ctx.query(
      `INSERT INTO registration_codes (code_hash, tenant_id, branch_id, kind, created_at, expires_at)
       VALUES ($1, $2, $3, 'new_branch', $4, $5)`,
      [codeHash(code), input.tenantId, branchId, now, expiresAt],
    );
    return { code, branch_id: branchId, expires_at: expiresAt };
  });
}

async function createBranch(
  ctx: SystemContext,
  tenantId: string,
  branchName: string,
  now: number,
  ids: IdGen,
): Promise<string> {
  // 01b §4.3 row 19 (D-14a, §3.4): qualifying admins of the tenant: active, with a PIN, effective
  // access-hub-admin and manage-devices both allowed (no denial of either, a role granting each).
  const admins = await ctx.query<{ staff_id: string; display_name: string; name_key: string }>(
    `SELECT s.staff_id, s.display_name, lower(trim(s.display_name)) AS name_key
       FROM staff s
      WHERE s.tenant_id = $1 AND s.is_active AND s.pin_hash IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM staff_permission_denials d
                         WHERE d.tenant_id = s.tenant_id AND d.staff_id = s.staff_id
                           AND d.permission IN ('access-hub-admin', 'manage-devices'))
        AND (SELECT count(DISTINCT rp.permission)
               FROM staff_roles sr
               JOIN role_permissions rp ON rp.tenant_id = sr.tenant_id AND rp.role_id = sr.role_id
              WHERE sr.tenant_id = s.tenant_id AND sr.staff_id = s.staff_id AND rp.grant_type = 'allowed'
                AND rp.permission IN ('access-hub-admin', 'manage-devices')) = 2
      ORDER BY s.staff_id`,
    [tenantId],
  );
  // D-14b, B12: two admins with one name would clash at the new branch; refuse and list them, never rename.
  const byName = new Map<string, typeof admins>();
  for (const admin of admins) byName.set(admin.name_key, [...(byName.get(admin.name_key) ?? []), admin]);
  const duplicates = [...byName.values()].filter((group) => group.length > 1);
  if (duplicates.length > 0) {
    const listed = duplicates
      .map((group) => `${group[0]!.display_name.trim()} (${group.map((admin) => admin.staff_id).join(', ')})`)
      .join('; ');
    throw new Error(`admins share a name; rename them in the owner app, then run this again: ${listed}`);
  }
  const branchId = ids.next();
  try {
    await ctx.query(
      `INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, $2, $3, 'pending_hub', $4)`,
      [tenantId, branchId, branchName, now],
    );
  } catch (error) {
    if ((error as { constraint?: string }).constraint === 'branches_name') {
      throw new Error(`branch name already used in this tenant: ${branchName}`, { cause: error });
    }
    throw error;
  }
  await ctx.query(
    `INSERT INTO staff_branches (tenant_id, branch_id, staff_id) SELECT $1, $2, unnest($3::text[])`,
    [tenantId, branchId, admins.map((admin) => admin.staff_id)],
  );
  await ctx.query(`UPDATE tenants SET directory_version = directory_version + 1 WHERE tenant_id = $1`, [tenantId]);
  await ctx.query(
    `UPDATE owner_users
        SET allowed_branch_ids = array_append(allowed_branch_ids, $2)
      WHERE tenant_id = $1 AND NOT ($2 = ANY(allowed_branch_ids))`,
    [tenantId, branchId],
  );
  return branchId;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}

async function main(): Promise<void> {
  const tenantId = flag(process.argv, 'tenant-id');
  const branchName = flag(process.argv, 'branch-name');
  const branchId = flag(process.argv, 'branch-id');
  if (tenantId === undefined) throw new Error('missing --tenant-id');
  if ((branchName === undefined) === (branchId === undefined)) {
    throw new Error('pass exactly one of --branch-name or --branch-id');
  }
  const env = loadCloudEnv(process.env);
  const pool = createPool(env.DATABASE_URL);
  const clock = systemClock();
  try {
    const issued = await issueRegistrationCode(
      new SystemContext(pool),
      branchName === undefined ? { tenantId, branchId: branchId! } : { tenantId, branchName },
      { clock, ids: ulidGen(clock), secrets: cryptoSecrets },
    );
    process.stdout.write(`${issued.code}\n`);
  } finally {
    await pool.end();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'issue failed';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
