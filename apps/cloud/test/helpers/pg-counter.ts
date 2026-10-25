import type pg from 'pg';

const TRANSACTION_CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i;

// Counts statements run on this pool: pool.query and pool.connect() clients both check out a client
// ('acquire'), so wrapping client.query there sees every statement once. BEGIN / COMMIT / ROLLBACK do not count.
export function pgCounter(pool: pg.Pool): { readonly count: number; reset(): void } {
  let count = 0;
  const wrapped = new WeakSet<pg.PoolClient>();
  pool.on('acquire', (client) => {
    if (wrapped.has(client)) return;
    wrapped.add(client);
    const original = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as { query: unknown }).query = (...args: unknown[]) => {
      const first = args[0];
      const text = typeof first === 'string' ? first : (first as { text?: string } | undefined)?.text ?? '';
      if (!TRANSACTION_CONTROL.test(text)) count += 1;
      return original(...args);
    };
  });
  return {
    get count() {
      return count;
    },
    reset() {
      count = 0;
    },
  };
}
