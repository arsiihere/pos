/// <reference types="node" />
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/migrate.js';
import { systemClock, type Clock } from '../lib/clock.js';
import { loadCloudEnv } from '../lib/env.js';
import { SystemContext } from './system-context.js';

// §6.7a, S42: after a cloud restore, raise every branch's config_version and the tenant's directory_version to
// at least the clock's now, so every hub applies the restored data on its next poll. No config data changes,
// so no config_audit row (S26). An unknown tenant writes nothing.
export async function restoreBump(
  sys: SystemContext,
  input: { tenantId: string },
  deps: { clock: Clock },
): Promise<{ branches: Array<{ branch_id: string; before: number; after: number }>; directory: { before: number; after: number } }> {
  const now = deps.clock.branchNow();
  return sys.tx(async (ctx) => {
    const tenants = await ctx.query<{ directory_version: string }>(
      `SELECT directory_version FROM tenants WHERE tenant_id = $1 FOR UPDATE`,
      [input.tenantId],
    );
    if (tenants[0] === undefined) throw new Error('unknown tenant');
    const old = await ctx.query<{ branch_id: string; config_version: string }>(
      `SELECT branch_id, config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id FOR UPDATE`,
      [input.tenantId],
    );
    const raised = await ctx.query<{ branch_id: string; config_version: string }>(
      `UPDATE branches SET config_version = GREATEST(config_version + 1, $2) WHERE tenant_id = $1
       RETURNING branch_id, config_version`,
      [input.tenantId, now],
    );
    const directory = await ctx.query<{ directory_version: string }>(
      `UPDATE tenants SET directory_version = GREATEST(directory_version + 1, $2) WHERE tenant_id = $1
       RETURNING directory_version`,
      [input.tenantId, now],
    );
    return {
      branches: old.map((row) => ({
        branch_id: row.branch_id,
        before: Number(row.config_version),
        after: Number(raised.find((r) => r.branch_id === row.branch_id)!.config_version),
      })),
      directory: { before: Number(tenants[0].directory_version), after: Number(directory[0]!.directory_version) },
    };
  });
}

const USAGE = 'usage: restore-bump --tenant <tenant_id>';

// Returns the exit code: 0 on success, 1 on a usage error or an unknown tenant (nothing written).
export async function runRestoreBump(
  argv: readonly string[],
  deps: { sys: SystemContext; clock: Clock; out: (line: string) => void; err: (line: string) => void },
): Promise<number> {
  if (argv.length !== 2 || argv[0] !== '--tenant' || argv[1]!.startsWith('--')) {
    deps.err(USAGE);
    return 1;
  }
  try {
    const result = await restoreBump(deps.sys, { tenantId: argv[1]! }, deps);
    for (const branch of result.branches) deps.out(`branch ${branch.branch_id}: ${branch.before} → ${branch.after}`);
    deps.out(`directory: ${result.directory.before} → ${result.directory.after}`);
    return 0;
  } catch (error) {
    deps.err(error instanceof Error ? error.message : 'restore-bump failed');
    return 1;
  }
}

async function main(): Promise<number> {
  const env = loadCloudEnv(process.env);
  const pool = createPool(env.DATABASE_URL);
  try {
    return await runRestoreBump(process.argv.slice(2), {
      sys: new SystemContext(pool),
      clock: systemClock(),
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
      process.stderr.write(`${error instanceof Error ? error.message : 'restore-bump failed'}\n`);
      process.exit(1);
    },
  );
}
