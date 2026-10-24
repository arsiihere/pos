import pg from 'pg';

export function createPool(url: string): pg.Pool {
  return new pg.Pool({ connectionString: url });
}
