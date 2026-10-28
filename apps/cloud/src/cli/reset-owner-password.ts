/// <reference types="node" />
import { hash, Algorithm, Version } from '@node-rs/argon2';
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/migrate.js';
import { systemClock, type Clock } from '../lib/clock.js';
import { writeConfigAudit } from '../lib/config-audit.js';
import type { TenantSql } from '../lib/config-version.js';
import { loadCloudEnv } from '../lib/env.js';
import { ulidGen, type IdGen } from '../lib/ids.js';
import { cryptoSecrets, type SecretGen } from '../lib/secrets.js';
import { SystemContext } from './system-context.js';

// 00 M8
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: Algorithm.Argon2id, version: Version.V0x13 };

// 01b M3: the temporary password is valid for 24 h.
const TEMP_PASSWORD_TTL_MS = 86_400_000;

export interface ResetDeps {
  clock: Clock;
  ids: IdGen;
  secrets: SecretGen;
}

export interface ResetHooks {
  // test-only: called right after the owner row lock (01b test 74 c)
  afterOwnerRowLock?(): Promise<void>;
}

// 01b §6.14, B5: one transaction; the owner row FOR NO KEY UPDATE first (N2); credential_version + 1 stops every
// existing token (N1); counters, lock and notice cleared; every refresh token revoked; audit owner_user / password_reset.
export async function resetOwnerPassword(
  sys: SystemContext,
  input: { email: string },
  deps: ResetDeps,
  hooks?: ResetHooks,
): Promise<{ temporaryPassword: string; expiresAt: number }> {
  const raw = deps.secrets.crockford(16);
  const temporaryPassword = [0, 4, 8, 12].map((at) => raw.slice(at, at + 4)).join('-');
  const passwordHash = await hash(temporaryPassword, ARGON);
  return sys.tx(async (ctx) => {
    const rows = await ctx.query<{
      tenant_id: string;
      user_id: string;
      credential_version: number;
      password_changed_at: string | null;
      temp_password_expires_at: string | null;
    }>(
      `SELECT tenant_id, user_id, credential_version, password_changed_at, temp_password_expires_at
         FROM owner_users WHERE lower(email) = lower($1)
          FOR NO KEY UPDATE`,
      [input.email],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('unknown email');
    await hooks?.afterOwnerRowLock?.();
    const now = deps.clock.branchNow();
    const expiresAt = now + TEMP_PASSWORD_TTL_MS;
    const updated = await ctx.query<{ credential_version: number }>(
      `UPDATE owner_users
          SET password_hash = $3, must_change_password = true, temp_password_expires_at = $4,
              credential_version = credential_version + 1, password_changed_at = $5,
              failed_login_count = 0, login_window_started_at = NULL, login_locked_until = NULL, lock_notice_at = NULL
        WHERE tenant_id = $1 AND user_id = $2
        RETURNING credential_version`,
      [row.tenant_id, row.user_id, passwordHash, expiresAt, now],
    );
    await ctx.query(
      `UPDATE owner_refresh_tokens SET revoked_at = $3 WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [row.tenant_id, row.user_id, now],
    );
    const tenant: TenantSql = { query: (sql, params = []) => ctx.query(sql, [row.tenant_id, ...params]) };
    await writeConfigAudit(
      tenant,
      {
        actor: { kind: 'cli' },
        entity: 'owner_user',
        entityId: row.user_id,
        branchId: null,
        action: 'password_reset',
        before: {
          credential_version: Number(row.credential_version),
          password_changed_at: row.password_changed_at === null ? null : Number(row.password_changed_at),
          temp_password_expires_at: row.temp_password_expires_at === null ? null : Number(row.temp_password_expires_at),
        },
        after: { credential_version: Number(updated[0]!.credential_version), password_changed_at: now, temp_password_expires_at: expiresAt },
      },
      deps,
    );
    return { temporaryPassword, expiresAt };
  });
}

const USAGE = 'usage: reset-owner-password --email <email>';

// Returns the exit code: 0 on success, 1 on a usage error or an unknown email (nothing written).
// The temporary password goes to `out` once; it is never logged.
export async function runResetOwnerPassword(
  argv: readonly string[],
  deps: ResetDeps & { sys: SystemContext; out: (line: string) => void; err: (line: string) => void },
): Promise<number> {
  if (argv.length !== 2 || argv[0] !== '--email' || argv[1]!.startsWith('--')) {
    deps.err(USAGE);
    return 1;
  }
  try {
    const result = await resetOwnerPassword(deps.sys, { email: argv[1]! }, deps);
    deps.out(`temporary password: ${result.temporaryPassword}`);
    deps.out(`valid until: ${new Date(result.expiresAt).toISOString()}`);
    return 0;
  } catch (error) {
    deps.err(error instanceof Error ? error.message : 'reset-owner-password failed');
    return 1;
  }
}

async function main(): Promise<number> {
  const env = loadCloudEnv(process.env);
  const pool = createPool(env.DATABASE_URL);
  const clock = systemClock();
  try {
    return await runResetOwnerPassword(process.argv.slice(2), {
      sys: new SystemContext(pool),
      clock,
      ids: ulidGen(clock),
      secrets: cryptoSecrets,
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
      process.stderr.write(`${error instanceof Error ? error.message : 'reset-owner-password failed'}\n`);
      process.exit(1);
    },
  );
}
