/// <reference types="node" />
// 05 task 6a (plan PL-13): a fresh hub database with every merged migration plus the staged fiscal DDL
// (`src/billing/fiscal/outbox-ddl.sql`), which no migration runner reads.
// Task 6 (plan §2B.5) changes only this file: `stagedDdlPath` → null, `fiscalDdlText()` reads the 05
// migration, `freshOutboxDb()` → freshDb() + migrate(). outbox.test.ts needs no edit then.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../src/db/migrate';
import { fixedClock, T } from '../../../src/lib/clock';
import { freshDb } from '../../helpers/db';

export const migrationsDir = fileURLToPath(new URL('../../../src/db/migrations', import.meta.url));

/** The staged DDL file while it exists (phase 0a); null once task 6 moved it into the 05 migration. */
export const stagedDdlPath: string | null = fileURLToPath(
  new URL('../../../src/billing/fiscal/outbox-ddl.sql', import.meta.url),
);

/** The SQL text that holds the §5 fiscal DDL (the staged file now; the 05 migration after task 6). */
export function fiscalDdlText(): string {
  return readFileSync(stagedDdlPath!, 'utf8');
}

export type OutboxDb = ReturnType<typeof freshDb>;

export async function freshOutboxDb(): Promise<OutboxDb> {
  const fx = freshDb();
  try {
    await runMigrations(fx.db, { dir: migrationsDir, clock: fixedClock(T) });
    fx.db.exec(fiscalDdlText());
    return fx;
  } catch (e) {
    fx.cleanup();
    throw e;
  }
}
