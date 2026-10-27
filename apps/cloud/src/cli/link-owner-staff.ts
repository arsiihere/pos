/// <reference types="node" />
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/migrate.js';
import { systemClock, type Clock } from '../lib/clock.js';
import { writeConfigAudit } from '../lib/config-audit.js';
import type { TenantSql } from '../lib/config-version.js';
import { loadCloudEnv } from '../lib/env.js';
import { ulidGen, type IdGen } from '../lib/ids.js';
import { qualifyingAdmins } from '../modules/staff-roles/guards.js';
import { SystemContext } from './system-context.js';

export interface LinkDeps {
  clock: Clock;
  ids: IdGen;
  out: (line: string) => void;
}

export interface LinkHooks {
  // test-only: called right after the tenant row lock (01b test 99)
  afterTenantLock?(): Promise<void>;
}

// A refusal: exit 1, nothing written.
export class LinkRefused extends Error {}

// 01b §6.15a, B7, B11 (review 2 N3): one transaction in the lock order tenant → owner_users → staff.
// The same rules for a first link and a corrective re-link; a link is never an override.
export async function linkOwnerStaff(
  sys: SystemContext,
  input: { ownerUserId: string; staffId: string; confirmName?: string },
  deps: LinkDeps,
  hooks?: LinkHooks,
): Promise<{ email: string; oldStaffId: string | null; newStaffId: string; changed: boolean }> {
  return sys.tx(async (ctx) => {
    // (1) no lock, to learn the tenant
    const found = await ctx.query<{ tenant_id: string }>(`SELECT tenant_id FROM owner_users WHERE user_id = $1`, [input.ownerUserId]);
    const tenantId = found[0]?.tenant_id;
    if (tenantId === undefined) throw new LinkRefused('unknown owner');
    const tenant: TenantSql = { query: (sql, params = []) => ctx.query(sql, [tenantId, ...params]) };
    // (2) every directory write of the tenant now waits
    await tenant.query(`SELECT tenant_id FROM tenants WHERE tenant_id = $1 FOR NO KEY UPDATE`);
    await hooks?.afterTenantLock?.();
    // (3)
    const owners = await tenant.query<{ email: string; staff_id: string | null }>(
      `SELECT email, staff_id FROM owner_users WHERE tenant_id = $1 AND user_id = $2 FOR NO KEY UPDATE`,
      [input.ownerUserId],
    );
    const ownerRow = owners[0]!;
    // (4)
    const targets = await tenant.query<{ display_name: string; is_active: boolean; linked_to: string | null }>(
      `SELECT s.display_name, s.is_active,
              (SELECT o.user_id FROM owner_users o
                WHERE o.tenant_id = s.tenant_id AND o.staff_id = s.staff_id AND o.user_id <> $3) AS linked_to
         FROM staff s WHERE s.tenant_id = $1 AND s.staff_id = $2`,
      [input.staffId, input.ownerUserId],
    );
    const target = targets[0];
    if (target === undefined) throw new LinkRefused("staff not in this owner's tenant");
    if (!target.is_active) throw new LinkRefused('staff has left');
    if (target.linked_to !== null) throw new LinkRefused(`already linked to ${target.linked_to}`);
    // (5) print the target, so support can check it with the owner
    const summary = await tenant.query<{ role_names: string[]; branches: string[] }>(
      `SELECT ARRAY(SELECT r.name FROM staff_roles sr JOIN roles r ON r.tenant_id = sr.tenant_id AND r.role_id = sr.role_id
                     WHERE sr.tenant_id = $1 AND sr.staff_id = $2 ORDER BY lower(r.name), r.role_id) AS role_names,
              ARRAY(SELECT b.name || ' (' || b.branch_id || ')' FROM staff_branches sb
                      JOIN branches b ON b.tenant_id = sb.tenant_id AND b.branch_id = sb.branch_id
                     WHERE sb.tenant_id = $1 AND sb.staff_id = $2 ORDER BY lower(b.name), b.branch_id) AS branches`,
      [input.staffId],
    );
    deps.out(`staff: ${target.display_name} (${input.staffId})`);
    deps.out(`roles: ${summary[0]!.role_names.join(', ') || '(none)'}`);
    deps.out(`branches: ${summary[0]!.branches.join(', ') || '(none)'}`);
    // (6) no-op
    if (ownerRow.staff_id === input.staffId) {
      return { email: ownerRow.email, oldStaffId: ownerRow.staff_id, newStaffId: input.staffId, changed: false };
    }
    // (7) byte for byte, no trimming
    if (input.confirmName !== target.display_name) {
      throw new LinkRefused("confirm-name does not match the staff member's name (printed above)");
    }
    // (8) a vacuous "every branch" would accept any row
    const branches = await tenant.query<{ branch_id: string; name: string }>(
      `SELECT branch_id, name FROM branches WHERE tenant_id = $1 ORDER BY lower(name), branch_id`,
    );
    if (branches.length === 0) throw new LinkRefused('the tenant has no branch yet; seed-tenant links the owner');
    // (9) a qualifying admin at every branch of the tenant (§3.4, one statement)
    const admins = await qualifyingAdmins(tenant, [input.staffId]);
    const missing = branches.filter((branch) => admins.get(branch.branch_id)?.has(input.staffId) !== true);
    if (missing.length > 0) {
      const list = missing.map((branch) => `${branch.name} (${branch.branch_id})`).join(', ');
      throw new LinkRefused(`link refused: ${target.display_name} is not a qualifying admin at ${list}`);
    }
    // (10) no directory bump: owner_users is not directory data
    await tenant.query(`UPDATE owner_users SET staff_id = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      input.ownerUserId,
      input.staffId,
    ]);
    await writeConfigAudit(
      tenant,
      {
        actor: { kind: 'cli' },
        entity: 'owner_user',
        entityId: input.ownerUserId,
        branchId: null,
        action: 'update',
        before: { staff_id: ownerRow.staff_id },
        after: { staff_id: input.staffId },
      },
      deps,
    );
    return { email: ownerRow.email, oldStaffId: ownerRow.staff_id, newStaffId: input.staffId, changed: true };
  });
}

const USAGE = 'usage: link-owner-staff --owner <owner_user_id> --staff <staff_id> --confirm-name "<display name>"';

function parseArgs(argv: readonly string[]): { ownerUserId: string; staffId: string; confirmName?: string } | null {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (!['--owner', '--staff', '--confirm-name'].includes(flag) || value === undefined || values.has(flag)) return null;
    values.set(flag, value);
  }
  const ownerUserId = values.get('--owner');
  const staffId = values.get('--staff');
  if (ownerUserId === undefined || staffId === undefined || ownerUserId === '' || staffId === '') return null;
  const confirmName = values.get('--confirm-name');
  return { ownerUserId, staffId, ...(confirmName !== undefined ? { confirmName } : {}) };
}

// Returns the exit code: 0 on a link or a no-op, 1 on a usage error or a refusal (nothing written).
export async function runLinkOwnerStaff(
  argv: readonly string[],
  deps: LinkDeps & { sys: SystemContext; err: (line: string) => void },
  hooks?: LinkHooks,
): Promise<number> {
  const input = parseArgs(argv);
  if (input === null) {
    deps.err(USAGE);
    return 1;
  }
  try {
    const result = await linkOwnerStaff(deps.sys, input, deps, hooks);
    if (!result.changed) {
      deps.out(`already linked: ${result.email} → ${result.newStaffId}`);
      return 0;
    }
    deps.out(`owner: ${result.email}`);
    deps.out(`link: ${result.oldStaffId ?? '(none)'} → ${result.newStaffId}`);
    return 0;
  } catch (error) {
    if (!(error instanceof LinkRefused)) throw error;
    deps.err(error.message);
    return 1;
  }
}

async function main(): Promise<number> {
  const env = loadCloudEnv(process.env);
  const pool = createPool(env.DATABASE_URL);
  const clock = systemClock();
  try {
    return await runLinkOwnerStaff(process.argv.slice(2), {
      sys: new SystemContext(pool),
      clock,
      ids: ulidGen(clock),
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    });
  } finally {
    await pool.end();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'link-owner-staff failed'}\n`);
      process.exit(1);
    },
  );
}
