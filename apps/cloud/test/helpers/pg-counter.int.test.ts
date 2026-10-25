import { afterAll, describe, expect, it } from 'vitest';
import { createPool } from '../../src/db/migrate';
import { pgCounter } from './pg-counter';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://pos:pos@127.0.0.1:5433/pos_test';

describe('pgCounter', () => {
  const pool = createPool(databaseUrl);
  afterAll(async () => {
    await pool.end();
  });

  it('[01a §10 test infra] pgCounter counts statements on pool.query and on connected clients, not BEGIN/COMMIT', async () => {
    const counter = pgCounter(pool);
    expect(counter.count).toBe(0);
    await pool.query('SELECT 1');
    await pool.query({ text: 'SELECT $1::int AS n', values: [2] });
    expect(counter.count).toBe(2);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1');
      await client.query('SELECT 2');
      await client.query('COMMIT');
      await client.query('begin isolation level repeatable read');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(counter.count).toBe(4);

    counter.reset();
    expect(counter.count).toBe(0);
    const again = await pool.connect();
    try {
      await again.query('SELECT 3');
    } finally {
      again.release();
    }
    await pool.query('SELECT 4');
    expect(counter.count).toBe(2);
  });

  it('[01a §10 test infra] a second pgCounter on the same pool reuses the first: one listener, one wrap', async () => {
    const first = pgCounter(pool);
    const listeners = pool.listenerCount('acquire');
    const second = pgCounter(pool);
    expect(second).toBe(first);
    expect(pool.listenerCount('acquire')).toBe(listeners);
    first.reset();
    await pool.query('SELECT 1');
    expect(second.count).toBe(1);
  });
});
