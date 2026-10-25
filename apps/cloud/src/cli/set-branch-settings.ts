/// <reference types="node" />
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/migrate.js';
import { systemClock, type Clock } from '../lib/clock.js';
import { writeConfigAudit } from '../lib/config-audit.js';
import { bumpConfigVersion, type TenantSql } from '../lib/config-version.js';
import { loadCloudEnv } from '../lib/env.js';
import { ulidGen, type IdGen } from '../lib/ids.js';
import { SystemContext } from './system-context.js';

export interface BranchSettings {
  tax_enabled: boolean;
  day_stale_after_hours: number;
  day_min_gap_hours: number;
}

// §6.7, S33, S34: lock the branch row → merge → ranges and stale > gap on the merged values → update →
// branch_settings / update audit row (actor 'cli') → bump this branch. Any failure writes nothing.
export async function setBranchSettings(
  sys: SystemContext,
  input: { branchId: string; taxEnabled?: boolean; dayStaleAfterHours?: number; dayMinGapHours?: number },
  deps: { clock: Clock; ids: IdGen },
): Promise<BranchSettings> {
  return sys.tx(async (ctx) => {
    const rows = await ctx.query<BranchSettings & { tenant_id: string }>(
      `SELECT tenant_id, tax_enabled, day_stale_after_hours, day_min_gap_hours FROM branches WHERE branch_id = $1 FOR UPDATE`,
      [input.branchId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('unknown branch');
    const { tenant_id: tenantId, ...before } = row;
    const after: BranchSettings = {
      tax_enabled: input.taxEnabled ?? before.tax_enabled,
      day_stale_after_hours: input.dayStaleAfterHours ?? before.day_stale_after_hours,
      day_min_gap_hours: input.dayMinGapHours ?? before.day_min_gap_hours,
    };
    if (!inRange(after.day_stale_after_hours, 1, 72)) throw new Error('--day-stale-after-hours must be 1…72');
    if (!inRange(after.day_min_gap_hours, 0, 24)) throw new Error('--day-min-gap-hours must be 0…24');
    if (after.day_stale_after_hours <= after.day_min_gap_hours) {
      throw new Error('day_stale_after_hours must be greater than day_min_gap_hours');
    }
    await ctx.query(
      `UPDATE branches SET tax_enabled = $2, day_stale_after_hours = $3, day_min_gap_hours = $4 WHERE branch_id = $1`,
      [input.branchId, after.tax_enabled, after.day_stale_after_hours, after.day_min_gap_hours],
    );
    const tenant: TenantSql = { query: (sql, params = []) => ctx.query(sql, [tenantId, ...params]) };
    await writeConfigAudit(
      tenant,
      { actor: { kind: 'cli' }, entity: 'branch_settings', entityId: input.branchId, branchId: input.branchId, action: 'update', before, after },
      deps,
    );
    await bumpConfigVersion(tenant, { kind: 'branch', branchId: input.branchId });
    return after;
  });
}

function inRange(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

const USAGE =
  'usage: set-branch-settings --branch <branch_id> [--tax-enabled true|false] [--day-stale-after-hours <1…72>] [--day-min-gap-hours <0…24>]';

// Options come in pairs; an unknown option (e.g. --business-day-start, removed by S33) is a usage error.
function parseArgs(argv: readonly string[]): Parameters<typeof setBranchSettings>[1] {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]!;
    const value = argv[i + 1];
    if (!['--branch', '--tax-enabled', '--day-stale-after-hours', '--day-min-gap-hours'].includes(name)) {
      throw new Error(`unknown option ${name}`);
    }
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${name}`);
    values.set(name, value);
  }
  const branchId = values.get('--branch');
  if (branchId === undefined) throw new Error('missing --branch');
  const input: Parameters<typeof setBranchSettings>[1] = { branchId };
  const tax = values.get('--tax-enabled');
  if (tax !== undefined) {
    if (tax !== 'true' && tax !== 'false') throw new Error('--tax-enabled must be true or false');
    input.taxEnabled = tax === 'true';
  }
  const stale = values.get('--day-stale-after-hours');
  if (stale !== undefined) input.dayStaleAfterHours = integer('--day-stale-after-hours', stale);
  const gap = values.get('--day-min-gap-hours');
  if (gap !== undefined) input.dayMinGapHours = integer('--day-min-gap-hours', gap);
  if (values.size === 1) throw new Error('pass at least one setting');
  return input;
}

function integer(name: string, value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number`);
  return Number(value);
}

// Returns the exit code: 0 on success, 1 on a usage error or a refused change (nothing written).
export async function runSetBranchSettings(
  argv: readonly string[],
  deps: { sys: SystemContext; clock: Clock; ids: IdGen; out: (line: string) => void; err: (line: string) => void },
): Promise<number> {
  let input: Parameters<typeof setBranchSettings>[1];
  try {
    input = parseArgs(argv);
  } catch (error) {
    deps.err(error instanceof Error ? error.message : 'bad arguments');
    deps.err(USAGE);
    return 1;
  }
  try {
    const after = await setBranchSettings(deps.sys, input, deps);
    deps.out(
      `branch ${input.branchId}: tax_enabled=${after.tax_enabled} day_stale_after_hours=${after.day_stale_after_hours} day_min_gap_hours=${after.day_min_gap_hours}`,
    );
    return 0;
  } catch (error) {
    deps.err(error instanceof Error ? error.message : 'set-branch-settings failed');
    return 1;
  }
}

async function main(): Promise<number> {
  const env = loadCloudEnv(process.env);
  const pool = createPool(env.DATABASE_URL);
  const clock = systemClock();
  try {
    return await runSetBranchSettings(process.argv.slice(2), {
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
      process.stderr.write(`${error instanceof Error ? error.message : 'set-branch-settings failed'}\n`);
      process.exit(1);
    },
  );
}
