import type pg from 'pg';

export interface TenantContext {
  readonly tenantId: string;
  readonly branchIds: readonly string[];
}

type Queryable = pg.Pool | pg.PoolClient;

export function assertTenantContext(value: unknown): TenantContext {
  if (!isTenantContext(value)) throw new TypeError('TenantContext required');
  return value;
}

export class TenantScopedRepository {
  private readonly ctx: TenantContext;

  constructor(ctx: unknown, private readonly db: Queryable) {
    this.ctx = assertTenantContext(ctx);
  }

  async query<R extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<R[]> {
    if (!hasPlaceholder(sql, 1) || !hasPlaceholder(sql, 2)) {
      throw new TypeError('scoped SQL must reference $1 and $2');
    }
    const result = await this.db.query<R>(sql, [this.ctx.tenantId, [...this.ctx.branchIds], ...params]);
    return result.rows;
  }
}

function isTenantContext(value: unknown): value is TenantContext {
  if (typeof value !== 'object' || value === null || !Object.isFrozen(value)) return false;
  const ctx = value as { tenantId?: unknown; branchIds?: unknown };
  return typeof ctx.tenantId === 'string' && Array.isArray(ctx.branchIds);
}

function hasPlaceholder(sql: string, n: number): boolean {
  return new RegExp(`\\$${n}(?!\\d)`).test(sql);
}
