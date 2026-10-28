import { DomainError, ULID_RE } from '@pos/domain';
import { canonicalJson, sha256hex } from '@pos/domain/hash';
import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import type pg from 'pg';
import { TenantLevelRepository } from '../db/tenant-level-repository.js';
import type { TenantContext } from '../db/tenant-scoped-repository.js';
import type { Clock } from './clock.js';

const PRUNE_AGE_MS = 86_400_000;

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replay: boolean;
}

export async function inTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
  o?: { isolation?: 'REPEATABLE READ'; readOnly?: boolean },
): Promise<T> {
  const client = await pool.connect();
  try {
    const modes = [
      ...(o?.isolation !== undefined ? [`ISOLATION LEVEL ${o.isolation}`] : []),
      ...(o?.readOnly === true ? ['READ ONLY'] : []),
    ];
    await client.query(modes.length > 0 ? `BEGIN ${modes.join(' ')}` : 'BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

// S7: the key row is inserted first, in the create's transaction; the prune runs after COMMIT.
export async function withIdempotency<T>(
  ctx: {
    pool: pg.Pool;
    clock: Clock;
    tenant: TenantContext;
    log: Pick<FastifyBaseLogger, 'error'>;
    testHooks?: { beforePrune?(): Promise<void> };
  },
  request: { key: string | undefined; method: string; path: string; body: unknown },
  fn: (client: pg.PoolClient) => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  const key = request.key;
  if (key === undefined || !ULID_RE.test(key)) {
    throw new DomainError('VALIDATION_FAILED', {
      issues: [{ path: 'headers.idempotency-key', message: 'Idempotency-Key must be a ULID' }],
    });
  }
  const requestHash = sha256hex(
    canonicalJson({ method: request.method, path: request.path, body: request.body ?? null }),
  );
  const now = ctx.clock.branchNow();
  const client = await ctx.pool.connect();
  try {
    const repo = new TenantLevelRepository(ctx.tenant, client);
    let result: IdempotentResult<T>;
    let storedHash: string | undefined;
    await client.query('BEGIN');
    try {
      const inserted = await repo.query(
        `INSERT INTO idempotency_keys (tenant_id, idempotency_key, route, request_hash, created_at)
         SELECT tenant_id, $2, $3, $4, $5 FROM tenants WHERE tenant_id = $1
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING idempotency_key`,
        [key, `${request.method} ${request.path}`, requestHash, now],
      );
      if (inserted.length === 0) {
        // a concurrent holder of this key has committed by now (we waited on the primary key)
        const stored = await repo.query<{ request_hash: string; response_status: number; response_body: T }>(
          `SELECT request_hash, response_status, response_body FROM idempotency_keys
            WHERE tenant_id = $1 AND idempotency_key = $2`,
          [key],
        );
        const row = stored[0]!;
        storedHash = row.request_hash;
        result = { status: row.response_status, body: row.response_body, replay: true };
        await client.query('ROLLBACK');
      } else {
        const out = await fn(client);
        await repo.query(
          `UPDATE idempotency_keys SET response_status = $3, response_body = $4
            WHERE tenant_id = $1 AND idempotency_key = $2`,
          [key, out.status, JSON.stringify(out.body)],
        );
        await client.query('COMMIT');
        result = { status: out.status, body: out.body, replay: false };
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    if (result.replay) {
      if (storedHash !== requestHash) throw new DomainError('IDEMPOTENCY_KEY_MISMATCH', { idempotency_key: key });
      return result;
    }
    try {
      await ctx.testHooks?.beforePrune?.();
      await repo.query(
        `DELETE FROM idempotency_keys WHERE ctid IN (
           SELECT ctid FROM idempotency_keys WHERE tenant_id = $1 AND created_at < $2 LIMIT 100 FOR UPDATE SKIP LOCKED)`,
        [now - PRUNE_AGE_MS],
      );
    } catch (error) {
      ctx.log.error({ err: error }, 'idempotency prune failed');
    }
    return result;
  } finally {
    client.release();
  }
}

export function sendIdempotent(reply: FastifyReply, r: IdempotentResult<unknown>): FastifyReply {
  if (r.replay) void reply.header('Idempotent-Replay', 'true');
  return reply.status(r.status).send({ data: r.body });
}
