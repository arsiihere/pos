import type pg from 'pg';
import { assertTenantContext, type TenantContext } from './tenant-scoped-repository.js';

type Queryable = pg.Pool | pg.PoolClient;

export class TenantLevelRepository {
  private readonly ctx: TenantContext;

  constructor(ctx: unknown, private readonly db: Queryable) {
    this.ctx = assertTenantContext(ctx);
  }

  async query<R extends pg.QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<R[]> {
    if (!/tenant_id = \$1(?!\d)/.test(sql)) throw new TypeError('SQL must reference tenant_id = $1');
    const result = await this.db.query<R>(sql, [this.ctx.tenantId, ...params]);
    return result.rows;
  }
}
