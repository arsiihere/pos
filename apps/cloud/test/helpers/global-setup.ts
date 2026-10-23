import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test';

export default async function setup(): Promise<void> {
  const pool = new pg.Pool({ connectionString: url });
  let last: unknown;
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await pool.query('SELECT 1');
        return;
      } catch (error) {
        last = error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    throw last;
  } finally {
    await pool.end();
  }
}
