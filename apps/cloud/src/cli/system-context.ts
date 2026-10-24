import type pg from 'pg';

export class SystemContext {
  constructor(
    private readonly pool: pg.Pool,
    private readonly client?: pg.PoolClient,
  ) {}

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<R[]> {
    const result = await (this.client ?? this.pool).query<R>(sql, [...params]);
    return result.rows;
  }

  async tx<T>(fn: (ctx: SystemContext) => Promise<T>): Promise<T> {
    if (this.client !== undefined) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new SystemContext(this.pool, client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
