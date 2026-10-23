/// <reference types="node" />
import { hash, Algorithm, Version } from '@node-rs/argon2';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/migrate.js';
import { systemClock, type Clock } from '../lib/clock.js';
import { loadCloudEnv } from '../lib/env.js';
import { ulidGen, type IdGen } from '../lib/ids.js';
import { DEFAULT_ROLES } from '../modules/staff-roles/default-roles.js';
import { SystemContext } from './system-context.js';

const ARGON = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
};

export interface SeedTenantInput {
  name: string;
  currency: string;
  ownerEmail: string;
  ownerName: string;
  password: string;
  pin: string;
}

export async function seedTenant(
  sys: SystemContext,
  input: SeedTenantInput,
  deps: { clock: Clock; ids: IdGen },
): Promise<{ tenant_id: string; user_id: string; staff_id: string }> {
  if (input.password.length < 8 || input.password.length > 200) {
    throw new Error('password must be 8 to 200 characters');
  }
  if (!/^\d{4,6}$/.test(input.pin)) throw new Error('pin must be 4 to 6 digits');
  const [passwordHash, pinHash] = await Promise.all([hash(input.password, ARGON), hash(input.pin, ARGON)]);
  const now = deps.clock.branchNow();
  try {
    return await sys.tx(async (ctx) => {
      const existing = await ctx.query<{ user_id: string }>(
        `SELECT user_id FROM owner_users WHERE lower(email) = lower($1)`,
        [input.ownerEmail],
      );
      if (existing.length > 0) throw new Error('email already exists');
      const tenantId = deps.ids.next();
      const userId = deps.ids.next();
      const staffId = deps.ids.next();
      await ctx.query(
        `INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, $2, $3, $4)`,
        [tenantId, input.name, input.currency, now],
      );
      const roleIds = new Map<string, string>();
      for (const role of DEFAULT_ROLES) {
        const roleId = deps.ids.next();
        roleIds.set(role.name, roleId);
        await ctx.query(
          `INSERT INTO roles (tenant_id, role_id, name, session_idle_ttl_ms) VALUES ($1, $2, $3, $4)`,
          [tenantId, roleId, role.name, role.session_idle_ttl_ms],
        );
      }
      for (const role of DEFAULT_ROLES) {
        const roleId = roleIds.get(role.name);
        if (roleId === undefined) throw new Error(`missing role ${role.name}`);
        for (const grant of role.grants) {
          const approver = grant.approver_role === undefined ? null : (roleIds.get(grant.approver_role) ?? null);
          if (grant.approver_role !== undefined && approver === null) {
            throw new Error(`missing approver role ${grant.approver_role}`);
          }
          await ctx.query(
            `INSERT INTO role_permissions (tenant_id, role_id, permission, grant_type, approver_role_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [tenantId, roleId, grant.permission, grant.grant_type, approver],
          );
        }
      }
      await ctx.query(
        `INSERT INTO owner_users
           (tenant_id, user_id, email, display_name, password_hash, allowed_branch_ids, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, userId, input.ownerEmail, input.ownerName, passwordHash, [], now],
      );
      const ownerRoleId = roleIds.get('Owner');
      if (ownerRoleId === undefined) throw new Error('missing role Owner');
      await ctx.query(
        `INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, staffId, input.ownerName, pinHash, now, now],
      );
      await ctx.query(`INSERT INTO staff_roles (tenant_id, staff_id, role_id) VALUES ($1, $2, $3)`, [
        tenantId,
        staffId,
        ownerRoleId,
      ]);
      return { tenant_id: tenantId, user_id: userId, staff_id: staffId };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error('email already exists', { cause: error });
    throw error;
  }
}

export async function promptHidden(
  label: string,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<string> {
  const mute = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  output.write(label);
  const rl = createInterface({ input, output: mute, terminal: true });
  const answer = await new Promise<string>((resolve) => {
    rl.question('', (value) => resolve(value));
  });
  rl.close();
  output.write('\n');
  return answer;
}

async function confirmSecret(label: string): Promise<string> {
  const first = await promptHidden(`${label}: `);
  const second = await promptHidden(`${label} again: `);
  if (first !== second) throw new Error(`${label} does not match`);
  return first;
}

function flag(argv: readonly string[], name: string): string {
  const index = argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`missing --${name}`);
  return value;
}

async function main(): Promise<void> {
  const env = loadCloudEnv(process.env);
  const pool = createPool(env.DATABASE_URL);
  const clock = systemClock();
  try {
    const password = await confirmSecret('password');
    const pin = await confirmSecret('PIN');
    const created = await seedTenant(
      new SystemContext(pool),
      {
        name: flag(process.argv, 'name'),
        currency: flag(process.argv, 'currency'),
        ownerEmail: flag(process.argv, 'owner-email'),
        ownerName: flag(process.argv, 'owner-name'),
        password,
        pin,
      },
      { clock, ids: ulidGen(clock) },
    );
    process.stdout.write(`tenant_id ${created.tenant_id}\nuser_id ${created.user_id}\nstaff_id ${created.staff_id}\n`);
  } finally {
    await pool.end();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'seed failed';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
