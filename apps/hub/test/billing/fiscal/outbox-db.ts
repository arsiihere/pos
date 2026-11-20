/// <reference types="node" />
// 05 task 6a (plan PL-13) → task 6 (plan §2B.5): a fresh hub database with every merged migration. The §5 fiscal DDL
// that 6a staged in `src/billing/fiscal/outbox-ddl.sql` now lives in the 05 migration 0023_billing.sql (copied
// verbatim; the staged file is deleted), so `migrate()` alone creates fiscal_outbox and fiscal_credentials.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../src/db/migrate';
import { fixedClock, T } from '../../../src/lib/clock';
import { freshDb } from '../../helpers/db';

export const migrationsDir = fileURLToPath(new URL('../../../src/db/migrations', import.meta.url));

/** The SQL text that holds the §5 fiscal DDL: the 05 migration. */
export function fiscalDdlText(): string {
  return readFileSync(fileURLToPath(new URL('../../../src/db/migrations/0023_billing.sql', import.meta.url)), 'utf8');
}

export type OutboxDb = ReturnType<typeof freshDb>;

export async function freshOutboxDb(): Promise<OutboxDb> {
  const fx = freshDb();
  try {
    await runMigrations(fx.db, { dir: migrationsDir, clock: fixedClock(T) });
    return fx;
  } catch (e) {
    fx.cleanup();
    throw e;
  }
}
